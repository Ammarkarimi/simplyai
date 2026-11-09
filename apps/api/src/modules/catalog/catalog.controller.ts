import { Controller, Get } from '@nestjs/common';
import { getRegistry } from '@simplyai/core';
import { PROVIDERS } from '@simplyai/ai';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { PrismaService } from '../../infra/prisma.service';

@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  private async disabledIntegrations(): Promise<Set<string>> {
    return new Set((await this.prisma.db.integration.findMany({ where: { enabled: false }, select: { key: true } })).map((i) => i.key));
  }

  @RequirePermission('workflow:read')
  @Get('nodes')
  async nodes() {
    const disabled = await this.disabledIntegrations();
    return getRegistry().nodeDescriptions().filter((n) => !n.integration || !disabled.has(n.integration));
  }

  @RequirePermission('credential:read')
  @Get('credential-types')
  credentialTypes() {
    return getRegistry().credentialDescriptions();
  }

  @RequirePermission('workspace:read')
  @Get('integrations')
  async integrations(@Ws() ws: WorkspaceContext) {
    const disabled = await this.disabledIntegrations();
    const creds = await this.prisma.db.credential.groupBy({ by: ['type'], where: { workspaceId: ws.workspaceId }, _count: { _all: true } });
    const counts = Object.fromEntries(creds.map((c) => [c.type, c._count._all]));
    const registry = getRegistry();
    return registry.integrationDescriptions().filter((i) => !disabled.has(i.key)).map((i) => ({
      ...i,
      connections: i.credentialTypes.reduce((s, t) => s + (counts[t] ?? 0), 0),
      authKinds: [...new Set(i.credentialTypes.map((t) => registry.getCredential(t)?.authKind).filter(Boolean))],
      nodes: [...i.triggers, ...i.actions].map((t) => {
        const n = registry.getNode(t)!;
        return { type: n.type, displayName: n.displayName, description: n.description, trigger: !!n.trigger, operations: (n.properties.find((p) => p.name === 'operation')?.options ?? []).map((o) => o.name), docs: n.docs ?? null, outputExample: n.outputExample ?? null, properties: n.properties.filter((p) => p.type !== 'notice').map((p) => ({ name: p.name, displayName: p.displayName, type: p.type, required: !!p.required })) };
      }),
    }));
  }

  @RequirePermission('agent:read')
  @Get('ai/providers')
  providers() {
    return PROVIDERS;
  }
}
