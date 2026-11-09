/** zod schemas for API payloads (shared by api for validation and web for forms). */
import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[a-zA-Z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const signUpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(1).max(100).optional(),
  inviteToken: z.string().optional(),
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(10), password: passwordSchema });
export const verifyEmailSchema = z.object({ token: z.string().min(10) });
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});
export const changePasswordSchema = z.object({ currentPassword: z.string().optional(), newPassword: passwordSchema });

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  organizationId: z.string().optional(),
});
export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  activeEnvironment: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i).optional(),
  timezone: z.string().max(64).optional(),
});

export const inviteMemberSchema = z.object({ email: emailSchema, roleKey: z.string().min(1) });
export const updateMemberSchema = z.object({ roleKey: z.string().min(1) });

const position = z.object({ x: z.number().finite(), y: z.number().finite() });

export const nodeSettingsSchema = z
  .object({
    retry: z
      .object({
        enabled: z.boolean(),
        maxTries: z.number().int().min(1).max(10),
        waitBetweenMs: z.number().int().min(0).max(300_000),
        backoff: z.enum(['fixed', 'exponential']).optional(),
      })
      .optional(),
    timeoutMs: z.number().int().min(0).max(3_600_000).optional(),
    continueOnFail: z.boolean().optional(),
    errorOutput: z.boolean().optional(),
    alwaysOutputData: z.boolean().optional(),
    executeOnce: z.boolean().optional(),
  })
  .partial();

export const workflowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  type: z.string().min(1).max(120),
  typeVersion: z.number().int().optional(),
  position,
  parameters: z.record(z.unknown()).default({}),
  credentialId: z.string().nullable().optional(),
  disabled: z.boolean().optional(),
  notes: z.string().max(5_000).nullable().optional(),
  settings: nodeSettingsSchema.optional(),
});

export const workflowConnectionSchema = z.object({
  id: z.string().optional(),
  source: z.string().min(1),
  sourceOutput: z.number().int().min(0).default(0),
  target: z.string().min(1),
  targetInput: z.number().int().min(0).default(0),
});

export const workflowSettingsSchema = z
  .object({
    timeoutMs: z.number().int().min(0).max(24 * 3_600_000).optional(),
    errorWorkflowId: z.string().nullable().optional(),
    timezone: z.string().max(64).optional(),
    saveSuccessfulExecutions: z.boolean().optional(),
    maxParallelism: z.number().int().min(1).max(32).optional(),
  })
  .partial();

export const workflowMetaSchema = z
  .object({
    annotations: z
      .array(
        z.object({
          id: z.string(),
          text: z.string().max(10_000),
          color: z.string().max(32).optional(),
          position,
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      )
      .max(500)
      .optional(),
    groups: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().max(200),
          color: z.string().max(32).optional(),
          position,
          width: z.number(),
          height: z.number(),
        }),
      )
      .max(200)
      .optional(),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  })
  .partial();

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema).max(500),
  connections: z.array(workflowConnectionSchema).max(2_000),
  settings: workflowSettingsSchema.optional(),
  meta: workflowMetaSchema.optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().max(2_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  definition: workflowDefinitionSchema.optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().max(2_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  definition: workflowDefinitionSchema.optional(),
});

export const publishWorkflowSchema = z.object({ message: z.string().max(500).optional(), activate: z.boolean().optional() });

export const runWorkflowSchema = z.object({
  /** trigger node to start from, defaults to the first manual trigger */
  triggerNodeId: z.string().optional(),
  /** only run the ancestors of this node */
  destinationNodeId: z.string().optional(),
  inputData: z.unknown().optional(),
  /** use an unsaved definition coming from the editor */
  definition: workflowDefinitionSchema.optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
});

export const executionListQuerySchema = listQuerySchema.extend({
  status: z.enum(['QUEUED', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED']).optional(),
  workflowId: z.string().optional(),
  mode: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const createCredentialSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().min(1).max(80),
  data: z.record(z.unknown()),
});
export const updateCredentialSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** only provided fields are replaced; omitted secret fields keep their value */
  data: z.record(z.unknown()).optional(),
});

export const webhookUpdateSchema = z.object({
  methods: z.array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])).min(1).optional(),
  authType: z.enum(['NONE', 'HEADER', 'BASIC', 'HMAC']).optional(),
  auth: z
    .object({
      headerName: z.string().max(100).optional(),
      token: z.string().max(500).optional(),
      username: z.string().max(200).optional(),
      password: z.string().max(500).optional(),
      secret: z.string().max(500).optional(),
    })
    .optional(),
  responseMode: z.enum(['IMMEDIATE', 'LAST_NODE']).optional(),
  responseCode: z.number().int().min(100).max(599).optional(),
  responseHeaders: z.record(z.string()).optional(),
  responseBody: z.string().max(100_000).nullable().optional(),
});

export const agentToolSchema = z.object({
  id: z.string(),
  type: z.enum(['http', 'workflow', 'code', 'knowledge', 'dataTable', 'calculator', 'datetime', 'webSearch']),
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Tool names may only contain letters, digits, _ and -'),
  description: z.string().min(1).max(1_000),
  config: z.record(z.unknown()).default({}),
  requiresApproval: z.boolean().default(false),
});

export const agentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000).nullable().optional(),
  systemPrompt: z.string().max(50_000).default(''),
  provider: z.enum(['openai', 'anthropic', 'gemini', 'custom']),
  model: z.string().min(1).max(120),
  credentialId: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(200_000).default(1024),
  maxIterations: z.number().int().min(1).max(25).default(6),
  tools: z.array(agentToolSchema).max(30).default([]),
  knowledgeBaseIds: z.array(z.string()).max(10).default([]),
  memoryEnabled: z.boolean().default(true),
  memoryWindow: z.number().int().min(0).max(200).default(20),
  inputFormat: z.enum(['text', 'json']).default('text'),
  outputFormat: z.enum(['text', 'json']).default('text'),
  outputSchema: z.record(z.unknown()).nullable().optional(),
});

export const agentChatSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(50_000),
});

export const knowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000).nullable().optional(),
  embeddingProvider: z.enum(['openai', 'gemini', 'custom']),
  embeddingModel: z.string().min(1).max(120),
  credentialId: z.string().nullable().optional(),
  chunkSize: z.number().int().min(200).max(8_000).default(1000),
  chunkOverlap: z.number().int().min(0).max(2_000).default(150),
});

export const dataTableSchema = z.object({
  name: z.string().trim().min(1).max(100).regex(/^[\w\- ]+$/, 'Use letters, numbers, spaces, - or _'),
  description: z.string().max(1_000).nullable().optional(),
  columns: z
    .array(z.object({ name: z.string().trim().min(1).max(64), type: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'JSON']) }))
    .max(100)
    .default([]),
});
export const dataTableColumnSchema = z.object({
  name: z.string().trim().min(1).max(64),
  type: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'JSON']),
});
export const dataTableRowSchema = z.object({ data: z.record(z.unknown()) });
export const dataTableQuerySchema = listQuerySchema.extend({
  filterColumn: z.string().optional(),
  filterValue: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const variableKeySchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, digits and _');
export const variableSchema = z.object({
  scope: z.enum(['GLOBAL', 'WORKSPACE', 'WORKFLOW', 'ENVIRONMENT']),
  key: variableKeySchema,
  value: z.string().max(10_000),
  description: z.string().max(500).nullable().optional(),
  workflowId: z.string().nullable().optional(),
  environment: z.string().trim().max(40).nullable().optional(),
});
export const secretSchema = z.object({
  key: variableKeySchema,
  value: z.string().min(1).max(20_000),
  description: z.string().max(500).nullable().optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().max(2_000).default(''),
  category: z.string().trim().min(1).max(60),
  tags: z.array(z.string().max(40)).max(20).default([]),
  visibility: z.enum(['WORKSPACE', 'PRIVATE']),
  workflowId: z.string(),
});

export const apiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).default(120),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export const emitEventSchema = z.object({ event: z.string().trim().min(1).max(120), payload: z.record(z.unknown()).default({}) });

export const planUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(500).optional(),
  priceMonthlyCents: z.number().int().min(0).optional(),
  stripePriceId: z.string().max(200).nullable().optional(),
  maxWorkflows: z.number().int().min(-1).optional(),
  maxActiveWorkflows: z.number().int().min(-1).optional(),
  monthlyExecutions: z.number().int().min(-1).optional(),
  monthlyTasks: z.number().int().min(-1).optional(),
  monthlyAiTokens: z.number().int().min(-1).optional(),
  maxCredentials: z.number().int().min(-1).optional(),
  maxMembers: z.number().int().min(-1).optional(),
  maxWorkspaces: z.number().int().min(-1).optional(),
  executionRetentionDays: z.number().int().min(1).optional(),
  isPublic: z.boolean().optional(),
});

export const featureFlagSchema = z.object({
  key: z.string().regex(/^[a-z0-9_.-]{1,80}$/),
  description: z.string().max(500).default(''),
  enabled: z.boolean().default(false),
  rolloutPercentage: z.number().int().min(0).max(100).default(100),
  workspaceIds: z.array(z.string()).default([]),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;
export type AgentInput = z.infer<typeof agentSchema>;
export type AgentTool = z.infer<typeof agentToolSchema>;
export type VariableInput = z.infer<typeof variableSchema>;
