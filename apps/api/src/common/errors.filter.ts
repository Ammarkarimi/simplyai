import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@simplyai/db';
import { QuotaExceededError, TriggerConfigError } from '@simplyai/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'string' ? { message: r } : { ...(r as Record<string, unknown>) };
      if (Array.isArray(body.message)) body.message = (body.message as string[]).join('; ');
    } else if (exception instanceof QuotaExceededError) {
      status = HttpStatus.PAYMENT_REQUIRED;
      body = { message: exception.message, code: 'QUOTA_EXCEEDED', limit: exception.limit };
    } else if (exception instanceof TriggerConfigError) {
      status = HttpStatus.BAD_REQUEST;
      body = { message: exception.message };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        body = { message: `A record with this ${(exception.meta?.target as string[] | undefined)?.join(', ') ?? 'value'} already exists` };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { message: 'Not found' };
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        body = { message: 'Referenced record does not exist' };
      } else this.logger.error(exception.message);
    } else {
      this.logger.error((exception as Error)?.stack ?? String(exception));
    }
    res.status(status).json({ statusCode: status, ...body });
  }
}
