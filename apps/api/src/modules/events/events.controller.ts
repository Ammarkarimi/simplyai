import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { dispatchEvent } from '@simplyai/core';
import { emitEventSchema } from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';

@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService, private readonly q: QueuesService) {}

  /** Emit an app event; every active workflow with a matching App Event Trigger starts. */
  @RequirePermission('workflow:execute')
  @HttpCode(202)
  @Post()
  async emit(@Ws() ws: WorkspaceContext, @Body(zbody(emitEventSchema)) body: z.infer<typeof emitEventSchema>) {
    const started = await dispatchEvent(this.prisma.db, this.q.queues, ws.workspaceId, body.event, body.payload);
    return { event: body.event, workflowsTriggered: started };
  }
}
