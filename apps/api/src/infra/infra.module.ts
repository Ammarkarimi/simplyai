import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { QueuesService } from './queues.service';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, QueuesService, MailService],
  exports: [PrismaService, RedisService, QueuesService, MailService],
})
export class InfraModule {}
