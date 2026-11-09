import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { InfraModule } from './infra/infra.module';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter } from './common/errors.filter';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { ExecutionsModule } from './modules/executions/executions.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { VariablesModule } from './modules/variables/variables.module';
import { DataTablesModule } from './modules/datatables/datatables.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { ApiKeysModule } from './modules/apikeys/apikeys.module';
import { AgentsModule } from './modules/agents/agents.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { BillingModule } from './modules/billing/billing.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AdminModule } from './modules/admin/admin.module';
import { EventsModule } from './modules/events/events.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    InfraModule, CommonModule, AuthModule, WorkspacesModule, WorkflowsModule, ExecutionsModule, CatalogModule, CredentialsModule, WebhooksModule,
    VariablesModule, DataTablesModule, TemplatesModule, ApiKeysModule, AgentsModule, KnowledgeModule, BillingModule, DashboardModule,
    AdminModule, EventsModule, RealtimeModule, HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
