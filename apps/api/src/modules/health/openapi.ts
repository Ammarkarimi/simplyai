import { env } from '@simplyai/core';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ content: { 'application/json': { schema } } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
  { name: 'search', in: 'query', schema: { type: 'string' } },
];
const errors = {
  '401': { description: 'Missing or invalid API key' },
  '403': { description: 'API key lacks the required scope' },
  '404': { description: 'Not found' },
  '429': { description: 'Rate limit exceeded' },
};

/** OpenAPI 3.1 description of the public REST API. */
export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SimplyAI Public API',
      version: '1.0.0',
      description: 'Manage workflows and executions programmatically. Authenticate with an API key created in Settings → API keys: `Authorization: Bearer sai_…`. Each key is bound to one workspace and limited by scopes and a per-minute rate limit (see `x-ratelimit-*` headers).',
    },
    servers: [{ url: `${env.apiUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'API key starting with sai_' } },
      schemas: {
        Node: { type: 'object', required: ['id', 'name', 'type', 'position', 'parameters'], properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', example: 'simplyai.httpRequest' }, position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, parameters: { type: 'object' }, credentialId: { type: ['string', 'null'] }, disabled: { type: 'boolean' }, settings: { type: 'object' } } },
        Connection: { type: 'object', required: ['source', 'target'], properties: { source: { type: 'string' }, sourceOutput: { type: 'integer', default: 0 }, target: { type: 'string' }, targetInput: { type: 'integer', default: 0 } } },
        Definition: { type: 'object', required: ['nodes', 'connections'], properties: { nodes: { type: 'array', items: ref('Node') }, connections: { type: 'array', items: ref('Connection') }, settings: { type: 'object' } } },
        Workflow: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: ['string', 'null'] }, active: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, definition: ref('Definition') } },
        Execution: { type: 'object', properties: { id: { type: 'string' }, workflowId: { type: 'string' }, mode: { type: 'string' }, status: { type: 'string', enum: ['QUEUED', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED'] }, queuedAt: { type: 'string', format: 'date-time' }, startedAt: { type: ['string', 'null'] }, finishedAt: { type: ['string', 'null'] }, durationMs: { type: ['integer', 'null'] }, outputData: {}, error: {} } },
        Page: { type: 'object', properties: { items: { type: 'array', items: {} }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' }, pageCount: { type: 'integer' } } },
      },
    },
    paths: {
      '/workflows': {
        get: { tags: ['Workflows'], summary: 'List workflows (scope workflows:read)', parameters: [...pageParams, { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }], responses: { '200': { description: 'Page of workflows', ...json(ref('Page')) }, ...errors } },
        post: { tags: ['Workflows'], summary: 'Create a workflow (scope workflows:write)', requestBody: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, definition: ref('Definition') } }), responses: { '201': { description: 'Created', ...json(ref('Workflow')) }, ...errors } },
      },
      '/workflows/{id}': {
        get: { tags: ['Workflows'], summary: 'Get a workflow with its draft definition', parameters: [idParam], responses: { '200': { description: 'Workflow', ...json(ref('Workflow')) }, ...errors } },
        patch: { tags: ['Workflows'], summary: 'Update name, tags or definition (scope workflows:write)', parameters: [idParam], requestBody: json({ type: 'object', properties: { name: { type: 'string' }, definition: ref('Definition') } }), responses: { '200': { description: 'Updated' }, ...errors } },
        delete: { tags: ['Workflows'], summary: 'Delete a workflow (scope workflows:write)', parameters: [idParam], responses: { '200': { description: 'Deleted' }, ...errors } },
      },
      '/workflows/{id}/publish': { post: { tags: ['Workflows'], summary: 'Create a version from the draft, optionally activating it', parameters: [idParam], requestBody: json({ type: 'object', properties: { message: { type: 'string' }, activate: { type: 'boolean' } } }), responses: { '200': { description: 'Version created' }, ...errors } } },
      '/workflows/{id}/activate': { post: { tags: ['Workflows'], summary: 'Activate triggers of the published version', parameters: [idParam], responses: { '200': { description: 'Activated' }, ...errors } } },
      '/workflows/{id}/deactivate': { post: { tags: ['Workflows'], summary: 'Deactivate triggers', parameters: [idParam], responses: { '200': { description: 'Deactivated' }, ...errors } } },
      '/workflows/{id}/run': { post: { tags: ['Workflows'], summary: 'Run a workflow (scope workflows:execute). inputData becomes the trigger items.', parameters: [idParam], requestBody: json({ type: 'object', properties: { inputData: {}, triggerNodeId: { type: 'string' } } }), responses: { '201': { description: 'Queued', ...json({ type: 'object', properties: { executionId: { type: 'string' }, status: { type: 'string' } } }) }, '402': { description: 'Plan quota exceeded' }, ...errors } } },
      '/executions': { get: { tags: ['Executions'], summary: 'List executions (scope executions:read)', parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'workflowId', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Page of executions', ...json(ref('Page')) }, ...errors } } },
      '/executions/{id}': { get: { tags: ['Executions'], summary: 'Get an execution with node-level results', parameters: [idParam], responses: { '200': { description: 'Execution', ...json(ref('Execution')) }, ...errors } }, delete: { tags: ['Executions'], summary: 'Delete a finished execution (scope executions:write)', parameters: [idParam], responses: { '200': { description: 'Deleted' }, ...errors } } },
      '/executions/{id}/retry': { post: { tags: ['Executions'], summary: 'Retry a finished execution (scope executions:write)', parameters: [idParam], responses: { '201': { description: 'New execution queued' }, ...errors } } },
      '/executions/{id}/cancel': { post: { tags: ['Executions'], summary: 'Cancel a queued, running or waiting execution', parameters: [idParam], responses: { '200': { description: 'Cancelled' }, ...errors } } },
      '/executions/{id}/approve': { post: { tags: ['Executions'], summary: 'Approve or reject a Human Approval step', parameters: [idParam], requestBody: json({ type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' }, comment: { type: 'string' } } }), responses: { '200': { description: 'Resumed' }, ...errors } } },
      '/events': { post: { tags: ['Events'], summary: 'Emit an app event (scope events:write)', requestBody: json({ type: 'object', required: ['event'], properties: { event: { type: 'string' }, payload: { type: 'object' } } }), responses: { '202': { description: 'Dispatched', ...json({ type: 'object', properties: { workflowsTriggered: { type: 'integer' } } }) }, ...errors } } },
    },
  };
}
