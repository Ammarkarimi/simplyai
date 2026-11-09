import { DEFAULT_PLANS, SYSTEM_ROLES } from '@simplyai/shared';
import { prisma } from '../client';
import { seedTemplates } from './templates';
import { seedDemo } from './demo';

const FLAGS = [
  { key: 'editor.ai_assist', description: 'AI assistant inside the workflow editor', enabled: false },
  { key: 'agents.web_search', description: 'Web search tool for agents', enabled: false },
  { key: 'executions.stream_payloads', description: 'Stream node payloads to the debugger', enabled: true },
];

export async function seed(options: { demo?: boolean } = {}) {
  for (const r of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({ where: { workspaceId: null, key: r.key } });
    const data = { name: r.name, description: r.description, permissions: r.permissions, rank: r.rank, isSystem: true };
    if (existing) await prisma.role.update({ where: { id: existing.id }, data });
    else await prisma.role.create({ data: { key: r.key, workspaceId: null, ...data } });
  }
  for (const p of DEFAULT_PLANS) {
    const { key, ...rest } = p;
    await prisma.plan.upsert({ where: { key }, create: { key, ...rest }, update: { name: rest.name, description: rest.description, features: rest.features, sortOrder: rest.sortOrder } });
  }
  for (const f of FLAGS) await prisma.featureFlag.upsert({ where: { key: f.key }, create: f, update: { description: f.description } });
  const templates = await seedTemplates(prisma);
  let demo = null;
  if (options.demo) demo = await seedDemo(prisma);
  return { roles: SYSTEM_ROLES.length, plans: DEFAULT_PLANS.length, templates, demo };
}

if (require.main === module) {
  seed({ demo: process.env.SEED_DEMO !== 'false' })
    .then((r) => {
      console.log('Seed complete', r);
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
