/**
 * S-R7 — unit tests for {@link ZodValidationPipe}, the framework validation seam (PipeTransform pattern)
 * that replaces the collections controller's in-handler `parseOrThrow`. Pins the generic contract (valid
 * input parses through, invalid input throws a `BadRequestException` carrying the zod issue messages —
 * byte-identical to the historical error shape) AND relocates the collections-schema-specific bad-input
 * cases that used to be asserted by calling the controller's handlers directly with malformed input —
 * now that validation lives at the pipe boundary, direct handler calls bypass it entirely, so this suite
 * is the sole home for that coverage (see `collections.controller.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../zod-validation.pipe.js';
import {
    addRecipeSchema,
    createCollectionSchema,
    pageQuerySchema,
    updateCollectionSchema,
} from '../../../collections/collections.schemas.js';

describe('ZodValidationPipe', () => {
    describe('generic contract', () => {
        const schema = z.object({ name: z.string().min(1) });

        it('returns the parsed data for valid input', () => {
            const pipe = new ZodValidationPipe(schema);

            expect(pipe.transform({ name: 'ok' })).toEqual({ name: 'ok' });
        });

        it('throws a BadRequestException carrying the zod issue messages for invalid input', () => {
            const pipe = new ZodValidationPipe(schema);

            try {
                pipe.transform({ name: '' });
                expect.unreachable('transform should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(BadRequestException);
                const response = (error as BadRequestException).getResponse() as { message: string[] };
                expect(response.message).toEqual(['Too small: expected string to have >=1 characters']);
            }
        });
    });

    describe('relocated collections bad-input coverage', () => {
        it('rejects an empty collection name (createCollectionSchema)', () => {
            const pipe = new ZodValidationPipe(createCollectionSchema);

            expect(() => pipe.transform({ name: '' })).toThrow(BadRequestException);
        });

        it('accepts a valid create body and returns it parsed', () => {
            const pipe = new ZodValidationPipe(createCollectionSchema);

            expect(pipe.transform({ name: 'Weeknight Dinners' })).toEqual({ name: 'Weeknight Dinners' });
        });

        it('rejects an empty update patch (minProperties: 1)', () => {
            const pipe = new ZodValidationPipe(updateCollectionSchema);

            try {
                pipe.transform({});
                expect.unreachable('transform should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(BadRequestException);
                const response = (error as BadRequestException).getResponse() as { message: string[] };
                expect(response.message).toEqual(['At least one field must be provided.']);
            }
        });

        it('rejects an invalid visibility enum value', () => {
            const pipe = new ZodValidationPipe(updateCollectionSchema);

            expect(() => pipe.transform({ visibility: 'unlisted' })).toThrow(BadRequestException);
        });

        it('rejects a non-uuid recipeId (addRecipeSchema)', () => {
            const pipe = new ZodValidationPipe(addRecipeSchema);

            expect(() => pipe.transform({ recipeId: 'not-a-uuid' })).toThrow(BadRequestException);
        });

        it('rejects a pageSize over the cap (pageQuerySchema)', () => {
            const pipe = new ZodValidationPipe(pageQuerySchema);

            expect(() => pipe.transform({ pageSize: '500' })).toThrow(BadRequestException);
        });

        it('applies pagination defaults for an empty query', () => {
            const pipe = new ZodValidationPipe(pageQuerySchema);

            expect(pipe.transform({})).toEqual({ page: 1, pageSize: 20 });
        });

        it('coerces page/pageSize query strings to numbers', () => {
            const pipe = new ZodValidationPipe(pageQuerySchema);

            expect(pipe.transform({ page: '2', pageSize: '5' })).toEqual({ page: 2, pageSize: 5 });
        });
    });
});
