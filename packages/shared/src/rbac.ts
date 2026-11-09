/** Role based access control: permission catalog and system roles. */

export const PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'members:read',
  'members:manage',
  'workflow:read',
  'workflow:create',
  'workflow:update',
  'workflow:delete',
  'workflow:activate',
  'workflow:execute',
  'execution:read',
  'execution:manage',
  'credential:read',
  'credential:manage',
  'agent:read',
  'agent:manage',
  'agent:run',
  'datatable:read',
  'datatable:manage',
  'variable:read',
  'variable:manage',
  'secret:manage',
  'webhook:read',
  'webhook:manage',
  'template:manage',
  'apikey:manage',
  'billing:read',
  'billing:manage',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type SystemRoleKey = 'owner' | 'admin' | 'editor' | 'operator' | 'viewer';

const viewer: Permission[] = [
  'workspace:read',
  'members:read',
  'workflow:read',
  'execution:read',
  'credential:read',
  'agent:read',
  'datatable:read',
  'variable:read',
  'webhook:read',
  'billing:read',
];

const operator: Permission[] = [
  ...viewer,
  'workflow:activate',
  'workflow:execute',
  'execution:manage',
  'agent:run',
];

const editor: Permission[] = [
  ...operator,
  'workflow:create',
  'workflow:update',
  'workflow:delete',
  'credential:manage',
  'agent:manage',
  'datatable:manage',
  'variable:manage',
  'secret:manage',
  'webhook:manage',
  'template:manage',
];

const admin: Permission[] = [...editor, 'workspace:update', 'members:manage', 'apikey:manage', 'audit:read'];

const owner: Permission[] = [...PERMISSIONS];

export interface SystemRole {
  key: SystemRoleKey;
  name: string;
  description: string;
  rank: number;
  permissions: Permission[];
}

export const SYSTEM_ROLES: SystemRole[] = [
  { key: 'owner', name: 'Owner', rank: 100, description: 'Full control including billing and deletion', permissions: owner },
  { key: 'admin', name: 'Admin', rank: 80, description: 'Manage members, API keys and all resources', permissions: admin },
  { key: 'editor', name: 'Editor', rank: 60, description: 'Build and edit workflows, agents and credentials', permissions: editor },
  { key: 'operator', name: 'Operator', rank: 40, description: 'Run, activate and monitor workflows', permissions: operator },
  { key: 'viewer', name: 'Viewer', rank: 20, description: 'Read-only access', permissions: viewer },
];

export function roleHas(permissions: readonly string[], required: Permission | Permission[]): boolean {
  const list = Array.isArray(required) ? required : [required];
  return list.every((p) => permissions.includes(p));
}

export const API_KEY_SCOPES = [
  { key: 'workflows:read', description: 'List and read workflows', permissions: ['workflow:read'] },
  { key: 'workflows:write', description: 'Create, update, delete and activate workflows', permissions: ['workflow:create', 'workflow:update', 'workflow:delete', 'workflow:activate'] },
  { key: 'workflows:execute', description: 'Run workflows', permissions: ['workflow:execute'] },
  { key: 'executions:read', description: 'List and read executions', permissions: ['execution:read'] },
  { key: 'executions:write', description: 'Retry and cancel executions', permissions: ['execution:manage'] },
  { key: 'events:write', description: 'Emit app events that trigger workflows', permissions: ['workflow:execute'] },
] as const satisfies readonly { key: string; description: string; permissions: Permission[] }[];

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]['key'];

export function permissionsForScopes(scopes: readonly string[]): Permission[] {
  const out = new Set<Permission>();
  for (const s of API_KEY_SCOPES) if (scopes.includes(s.key)) s.permissions.forEach((p) => out.add(p));
  return [...out];
}
