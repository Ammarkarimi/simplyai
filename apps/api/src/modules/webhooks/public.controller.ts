import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Item, WorkflowDefinition } from '@simplyai/shared';
import { Public, RateLimit, Req } from '../../common/decorators';
import type { AppRequest } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { WebhooksService } from './webhooks.service';

interface FormField { label: string; name: string; fieldType: string; options?: string; required?: boolean }
const chatSchema = z.object({ sessionId: z.string().min(6).max(100), message: z.string().min(1).max(5000) });

/** Hosted forms and chat pages. */
@Controller('public')
export class PublicController {
  constructor(private readonly prisma: PrismaService, private readonly webhooks: WebhooksService) {}

  private async load(path: string, kind: 'FORM' | 'CHAT', test: boolean, req: AppRequest) {
    const w = await this.prisma.db.webhook.findUnique({ where: { path } });
    if (!w || w.kind !== kind) throw new NotFoundException('Not found');
    if (test) {
      if (req.auth?.kind !== 'session') throw new NotFoundException('Sign in to use the test version');
      const member = await this.prisma.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: w.workspaceId, userId: req.auth.user.id } } });
      if (!member) throw new NotFoundException('Not found');
    } else if (!w.active) throw new NotFoundException('This page is not active');
    const { definition } = await this.webhooks.definitionFor(w, test);
    const node = (definition as WorkflowDefinition).nodes.find((n) => n.id === w.nodeKey);
    if (!node) throw new NotFoundException('Not found');
    return { w, params: node.parameters };
  }

  @Public()
  @Get('forms/:path')
  async form(@Param('path') path: string, @Query('test') test: string, @Req() req: AppRequest) {
    const { params } = await this.load(path, 'FORM', test === '1', req);
    return { title: params.formTitle ?? 'Form', description: params.formDescription ?? '', fields: (params.fields as FormField[]) ?? [], submitLabel: params.submitLabel ?? 'Submit' };
  }

  @Public()
  @RateLimit(30, 60)
  @HttpCode(200)
  @Post('forms/:path')
  async submit(@Param('path') path: string, @Query('test') test: string, @Body() body: Record<string, unknown>, @Req() req: AppRequest) {
    const { w, params } = await this.load(path, 'FORM', test === '1', req);
    const fields = (params.fields as FormField[]) ?? [];
    const data: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const f of fields) {
      let v = body?.[f.name];
      if (f.fieldType === 'checkbox') v = v === true || v === 'true' || v === 'on';
      else if (typeof v === 'string') v = v.trim().slice(0, 10_000);
      if (f.required && (v === undefined || v === '' || v === null || v === false)) errors.push(`${f.label} is required`);
      if (f.fieldType === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) errors.push(`${f.label} must be a valid email`);
      if (f.fieldType === 'number' && v !== '' && v !== undefined) {
        if (Number.isNaN(Number(v))) errors.push(`${f.label} must be a number`);
        else v = Number(v);
      }
      if (f.fieldType === 'select' && v && f.options && !f.options.split(',').map((o) => o.trim()).includes(String(v))) errors.push(`${f.label} has an invalid option`);
      data[f.name] = v ?? null;
    }
    if (errors.length) throw new BadRequestException({ message: errors.join('; '), errors });
    const item: Item = { json: { ...data, submittedAt: new Date().toISOString() } };
    const ex = await this.webhooks.start(w, [item], test === '1', 'FORM', req.auth?.kind === 'session' ? req.auth.user.id : null);
    return { message: params.successMessage ?? 'Thanks!', executionId: test === '1' ? ex.id : undefined };
  }

  @Public()
  @Get('chat/:path')
  async chat(@Param('path') path: string, @Query('test') test: string, @Req() req: AppRequest) {
    const { params } = await this.load(path, 'CHAT', test === '1', req);
    return { title: params.title ?? 'Chat', welcomeMessage: params.welcomeMessage ?? '' };
  }

  @Public()
  @RateLimit(30, 60)
  @HttpCode(200)
  @Post('chat/:path')
  async message(@Param('path') path: string, @Query('test') test: string, @Body(zbody(chatSchema)) body: z.infer<typeof chatSchema>, @Req() req: AppRequest) {
    const { w, params } = await this.load(path, 'CHAT', test === '1', req);
    const ex = await this.webhooks.start(w, [{ json: { sessionId: body.sessionId, message: body.message, receivedAt: new Date().toISOString() } }], test === '1', 'CHAT');
    const result = await this.webhooks.waitForResult(ex.id, 60_000);
    if (!result) return { reply: 'I am still working on that, please check back in a moment.', executionId: ex.id };
    if (result.status !== 'SUCCESS') return { reply: 'Sorry, something went wrong while processing your message.', error: true, executionId: ex.id };
    const first = (result.output as Item[])[0]?.json ?? {};
    const field = String(params.responseField || 'output');
    const reply = first[field] ?? first.output ?? first.response ?? first.text ?? first.answer ?? JSON.stringify(first);
    return { reply: typeof reply === 'string' ? reply : JSON.stringify(reply), executionId: ex.id };
  }
}
