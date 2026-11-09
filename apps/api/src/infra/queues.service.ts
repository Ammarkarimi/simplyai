import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { QueueEvents } from 'bullmq';
import { createQueueEvents, createQueues, type Queues } from '@simplyai/core';

@Injectable()
export class QueuesService implements OnModuleDestroy {
  readonly queues: Queues = createQueues();
  private events = new Map<string, QueueEvents>();

  queueEvents(name: 'executions' | 'agents'): QueueEvents {
    let qe = this.events.get(name);
    if (!qe) {
      qe = createQueueEvents(name);
      this.events.set(name, qe);
    }
    return qe;
  }

  async onModuleDestroy() {
    await this.queues.close();
    await Promise.all([...this.events.values()].map((e) => e.close()));
  }
}
