import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import express, { type Request, type Response, type Router } from 'express';
import { Job } from 'bullmq';
import { decryptJson, encryptJson, safeEqual, type Prisma, type Webhook } from '@simplyai/db';
import { createExecution, loadDraftDefinition, QuotaExceededError, type ExecutionJobResult } from '@simplyai/core';
import type { Item, WorkflowDefinition } from '@simplyai/shared';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';
import { RedisService } from '../../infra/redis.service';

export interface WebhookAuthConfig {
  headerName?: string;
  token?: string;
  username?: string;
  password?: string;
  secret?: string;
}

const STRIP_HEADERS = new Set(['cookie', 'authorization', 'x-csrf-token', 'proxy-authorization']);

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');
  constructor(private readonly prisma: PrismaService, private readonly q: QueuesService, private readonly redis: RedisService) {}

  private get db() {
    return this.prisma.db;
  }

  authConfig(w: Webhook): WebhookAuthConfig {
    return w.encryptedAuth ? decryptJson<WebhookAuthConfig>(w.encryptedAuth, `webhook:${w.workspaceId}`) : {};
  }

  encryptAuth(workspaceId: string, cfg: WebhookAuthConfig): string {
    return encryptJson(cfg, `webhook:${workspaceId}`);
  }

  verifyAuth(w: Webhook, req: Request, raw: Buffer): boolean {
    if (w.authType === 'NONE') return true;
    const cfg = this.authConfig(w);
    if (w.authType === 'HEADER') {
      const v = String(req.headers[(cfg.headerName ?? 'x-webhook-token').toLowerCase()] ?? '');
      return !!cfg.token && safeEqual(v, cfg.token);
    }
    if (w.authType === 'BASIC') {
      const h = String(req.headers.authorization ?? '');
      if (!h.startsWith('Basic ')) return false;
      const [u, ...p] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
      return safeEqual(u ?? '', cfg.username ?? '') && safeEqual(p.join(':'), cfg.password ?? '');
    }
    if (w.authType === 'HMAC') {
      const sig = String(req.headers['x-simplyai-signature'] ?? req.headers['x-hub-signature-256'] ?? '');
      if (!cfg.secret || !sig) return false;
      const expected = `sha256=${createHmac('sha256', cfg.secret).update(raw).digest('hex')}`;
      return safeEqual(sig, expected);
    }
    return false;
  }

  parseBody(req: Request, raw: Buffer): unknown {
    if (!raw.length) return req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : null;
    const ct = String(req.headers['content-type'] ?? '');
    const text = raw.toString('utf8');
    if (ct.includes('json')) {
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpException({ message: 'Invalid JSON body' }, HttpStatus.BAD_REQUEST);
      }
    }
    if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
    return text;
  }

  /** Definition and version for live or test calls. */
  async definitionFor(w: Webhook, test: boolean): Promise<{ definition: WorkflowDefinition; versionId: string | null }> {
    if (test) return { definition: await loadDraftDefinition(this.db, w.workflowId), versionId: null };
    const wf = await this.db.workflow.findUnique({ where: { id: w.workflowId }, include: { activeVersion: true } });
    if (!wf?.active || !wf.activeVersion) throw new NotFoundException('This webhook is not active');
    return { definition: wf.activeVersion.definition as unknown as WorkflowDefinition, versionId: wf.activeVersion.id };
  }

  async start(w: Webhook, items: Item[], test: boolean, mode: 'WEBHOOK' | 'FORM' | 'CHAT', userId?: string | null) {
    const { definition, versionId } = await this.definitionFor(w, test);
    if (!definition.nodes.some((n) => n.id === w.nodeKey && !n.disabled)) throw new NotFoundException('The trigger node no longer exists');
    return createExecution(this.db, this.q.queues, {
      workspaceId: w.workspaceId, workflowId: w.workflowId, mode: test ? 'MANUAL' : mode, definition, workflowVersionId: versionId, triggerNodeId: w.nodeKey, items, createdById: userId ?? null,
    });
  }

  async waitForResult(executionId: string, timeoutMs = 30_000): Promise<ExecutionJobResult | null> {
    const job = await Job.fromId<{ executionId: string }, ExecutionJobResult>(this.q.queues.executions, executionId);
    if (!job) return null;
    try {
      return await job.waitUntilFinished(this.q.queueEvents('executions'), timeoutMs);
    } catch (err) {
      if (/timed out|before finishing/i.test((err as Error).message)) return null;
      return { status: 'FAILED', output: [], error: { message: (err as Error).message } };
    }
  }

  router(): Router {
    const router = express.Router();
    router.use(express.raw({ type: () => true, limit: '5mb' }));
    router.all('/{*path}', (req, res) => {
      void this.handle(req, res).catch((err) => {
        const status = err instanceof HttpException ? err.getStatus() : err instanceof QuotaExceededError ? 429 : 500;
        if (status === 500) this.logger.error((err as Error).stack);
        if (!res.headersSent) res.status(status).json({ message: status === 500 ? 'Webhook processing failed' : (err as Error).message });
      });
    });
    return router;
  }

  private async handle(req: Request, res: Response) {
    const started = Date.now();
    const test = req.baseUrl.endsWith('-test');
    const path = decodeURIComponent(req.path.replace(/^\/+|\/+$/g, ''));
    const w = await this.db.webhook.findUnique({ where: { path } });
    if (!w || w.kind !== 'WEBHOOK') throw new NotFoundException('Webhook not found');
    if (!test && !w.active) throw new NotFoundException('This webhook is not active. Activate the workflow to enable it.');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!w.methods.includes(req.method)) throw new HttpException({ message: `Method ${req.method} not allowed` }, HttpStatus.METHOD_NOT_ALLOWED);
    const limit = await this.redis.rateLimit(`webhook:${w.id}`, 600, 60);
    if (!limit.ok) throw new HttpException({ message: 'Too many requests' }, HttpStatus.TOO_MANY_REQUESTS);
    const raw = Buffer.isBuffer(req.body) ? req.body : ((req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0));
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !STRIP_HEADERS.has(k)));
    const record = async (statusCode: number, executionId?: string, body?: unknown) =>
      this.db.webhookRequest.create({
        data: { webhookId: w.id, method: req.method, headers: headers as Prisma.InputJsonValue, query: req.query as Prisma.InputJsonValue, body: (body ?? null) as Prisma.InputJsonValue, ip: req.ip, statusCode, executionId, test, durationMs: Date.now() - started },
      });
    if (!this.verifyAuth(w, req, raw)) {
      await record(401);
      return res.status(401).json({ message: 'Webhook authentication failed' });
    }
    const body = this.parseBody(req, raw);
    const item: Item = { json: { method: req.method, path, headers, query: req.query as Record<string, unknown>, body: body as never, receivedAt: new Date().toISOString() } };
    const execution = await this.start(w, [item], test, 'WEBHOOK');
    if (w.responseMode === 'LAST_NODE') {
      const result = await this.waitForResult(execution.id);
      await record(result ? (result.status === 'SUCCESS' ? w.responseCode : 500) : 202, execution.id, body);
      if (!result) return res.status(202).json({ message: 'Workflow is still running', executionId: execution.id });
      if (result.status !== 'SUCCESS') return res.status(500).json({ message: result.error?.message ?? `Workflow ${result.status.toLowerCase()}`, executionId: execution.id });
      const out = (result.output as Item[]).map((i) => i.json);
      this.applyHeaders(w, res);
      return res.status(w.responseCode).json(out.length === 1 ? out[0] : out);
    }
    await record(w.responseCode, execution.id, body);
    this.applyHeaders(w, res);
    if (w.responseBody) return res.status(w.responseCode).send(w.responseBody);
    return res.status(w.responseCode).json({ message: 'Workflow started', executionId: execution.id });
  }

  private applyHeaders(w: Webhook, res: Response) {
    for (const [k, v] of Object.entries((w.responseHeaders ?? {}) as Record<string, string>)) if (!/^(set-cookie|content-length)$/i.test(k)) res.setHeader(k, String(v));
  }
}
