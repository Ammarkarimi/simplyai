/** Default subscription plans. Values are seeded into the Plan table and editable in the admin panel. */

export type PlanKey = 'free' | 'starter' | 'professional' | 'business' | 'enterprise';

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  description: string;
  priceMonthlyCents: number;
  maxWorkflows: number;
  maxActiveWorkflows: number;
  monthlyExecutions: number;
  monthlyTasks: number;
  monthlyAiTokens: number;
  maxCredentials: number;
  maxMembers: number;
  maxWorkspaces: number;
  executionRetentionDays: number;
  features: string[];
  sortOrder: number;
}

/** -1 means unlimited */
export const UNLIMITED = -1;

export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    key: 'free', name: 'Free', description: 'For individuals exploring automation', priceMonthlyCents: 0,
    maxWorkflows: 5, maxActiveWorkflows: 2, monthlyExecutions: 1_000, monthlyTasks: 10_000, monthlyAiTokens: 100_000,
    maxCredentials: 5, maxMembers: 1, maxWorkspaces: 1, executionRetentionDays: 3,
    features: ['Visual workflow builder', 'Community templates', 'Webhooks'], sortOrder: 0,
  },
  {
    key: 'starter', name: 'Starter', description: 'For small teams automating core processes', priceMonthlyCents: 2_400,
    maxWorkflows: 25, maxActiveWorkflows: 10, monthlyExecutions: 10_000, monthlyTasks: 100_000, monthlyAiTokens: 1_000_000,
    maxCredentials: 25, maxMembers: 3, maxWorkspaces: 2, executionRetentionDays: 14,
    features: ['Everything in Free', 'AI agents', 'Schedules', 'Email support'], sortOrder: 1,
  },
  {
    key: 'professional', name: 'Professional', description: 'For growing businesses', priceMonthlyCents: 7_900,
    maxWorkflows: 150, maxActiveWorkflows: 50, monthlyExecutions: 100_000, monthlyTasks: 1_000_000, monthlyAiTokens: 10_000_000,
    maxCredentials: 100, maxMembers: 10, maxWorkspaces: 5, executionRetentionDays: 30,
    features: ['Everything in Starter', 'Knowledge bases & RAG', 'Public API', 'Version history'], sortOrder: 2,
  },
  {
    key: 'business', name: 'Business', description: 'For teams running mission critical automation', priceMonthlyCents: 29_900,
    maxWorkflows: 1_000, maxActiveWorkflows: 300, monthlyExecutions: 1_000_000, monthlyTasks: 10_000_000, monthlyAiTokens: 100_000_000,
    maxCredentials: 1_000, maxMembers: 50, maxWorkspaces: 20, executionRetentionDays: 90,
    features: ['Everything in Professional', 'Custom roles', 'Audit logs', 'Priority support'], sortOrder: 3,
  },
  {
    key: 'enterprise', name: 'Enterprise', description: 'Unlimited scale, SSO and dedicated support', priceMonthlyCents: 0,
    maxWorkflows: UNLIMITED, maxActiveWorkflows: UNLIMITED, monthlyExecutions: UNLIMITED, monthlyTasks: UNLIMITED, monthlyAiTokens: UNLIMITED,
    maxCredentials: UNLIMITED, maxMembers: UNLIMITED, maxWorkspaces: UNLIMITED, executionRetentionDays: 365,
    features: ['Everything in Business', 'Unlimited usage', 'Dedicated workers', 'SLA'], sortOrder: 4,
  },
];

export function withinLimit(limit: number, used: number, adding = 1): boolean {
  return limit === UNLIMITED || used + adding <= limit;
}
