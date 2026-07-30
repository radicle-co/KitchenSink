/**
 * S-R7 — the framework validation seam (Nest `PipeTransform` pattern) for Zod schemas. Bound per-route
 * as `@Body(new ZodValidationPipe(schema))` / `@Query(new ZodValidationPipe(schema))`, it runs at the
 * Nest binding boundary — BEFORE the handler body executes — rather than being hand-rolled inside each
 * handler. A `safeParse` failure throws a `BadRequestException` carrying the zod issue messages (the
 * exact shape the historical in-handler `parseOrThrow` threw, so the 400 response body is unchanged);
 * success returns the parsed, typed value the handler receives as an already-validated argument.
 */
import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates `value` against `schema` at the pipe boundary; throws a 400 with issue messages on failure. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
    public constructor(private readonly schema: ZodType<T>) {}

    public transform(value: unknown): T {
        const result = this.schema.safeParse(value);

        if (!result.success) {
            throw new BadRequestException(result.error.issues.map((issue) => issue.message));
        }

        return result.data;
    }
}
