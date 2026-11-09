import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new BadRequestException({
        message: r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}

export const zbody = <T>(schema: ZodSchema<T>) => new ZodPipe(schema);
