import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, MessageBody, type OnGatewayConnection } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { createRedis, env } from '@simplyai/core';
import { EVENTS_CHANNEL, type RealtimeEvent } from '@simplyai/shared';
import { PrismaService } from '../../infra/prisma.service';
import { verifyToken } from '../auth/session';

/** Relays engine events from Redis pub/sub to authorized browser sockets. */
@WebSocketGateway({ path: '/socket.io', cors: { origin: (process.env.APP_URL ?? 'http://localhost:3000').split(','), credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('Realtime');
  private sub = createRedis();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.sub.subscribe(EVENTS_CHANNEL);
    this.sub.on('message', (_channel, message) => {
      try {
        const e = JSON.parse(message) as RealtimeEvent;
        this.server?.to(`workspace:${e.workspaceId}`).emit('event', e);
        if ('executionId' in e) this.server?.to(`execution:${e.executionId}`).emit('event', e);
        if ('conversationId' in e) this.server?.to(`conversation:${e.conversationId}`).emit('event', e);
      } catch (err) {
        this.logger.warn(`Bad event: ${(err as Error).message}`);
      }
    });
  }

  onModuleDestroy() {
    this.sub.disconnect();
  }

  handleConnection(client: Socket) {
    const token = String(client.handshake.auth?.token ?? '');
    const userId = token ? verifyToken(token) : null;
    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
  }

  private async member(userId: string, workspaceId: string) {
    return this.prisma.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, include: { role: true } });
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { workspaceId?: string; executionId?: string; conversationId?: string }) {
    const userId = client.data.userId as string;
    if (!body?.workspaceId) return { ok: false };
    const m = await this.member(userId, body.workspaceId);
    if (!m) return { ok: false, error: 'Not a member' };
    if (body.executionId) {
      const ex = await this.prisma.db.execution.findFirst({ where: { id: body.executionId, workspaceId: body.workspaceId }, select: { id: true } });
      if (!ex) return { ok: false };
      await client.join(`execution:${body.executionId}`);
    } else if (body.conversationId) {
      const c = await this.prisma.db.agentConversation.findFirst({ where: { id: body.conversationId, workspaceId: body.workspaceId }, select: { id: true } });
      if (!c) return { ok: false };
      await client.join(`conversation:${body.conversationId}`);
    } else {
      if (!m.role.permissions.includes('execution:read')) return { ok: false };
      await client.join(`workspace:${body.workspaceId}`);
    }
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { executionId?: string; workspaceId?: string; conversationId?: string }) {
    if (body?.executionId) await client.leave(`execution:${body.executionId}`);
    if (body?.conversationId) await client.leave(`conversation:${body.conversationId}`);
    if (body?.workspaceId) await client.leave(`workspace:${body.workspaceId}`);
    return { ok: true };
  }
}

export const wsOrigins = () => env.appUrl;
