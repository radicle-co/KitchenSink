/**
 * THE RATINGS VERTICAL'S AUTHORED CONTRACT — the vertical that had no schema suite at all, and the one whose
 * request body was authored in the WRONG PACKAGE.
 *
 * Three properties, each of which fails if a specific regression is reintroduced:
 *
 *  1. **The bound IS `recipe-core`'s object** (`toBe`, not `toEqual`). An equivalent-looking
 *     `z.number().int().min(1).max(5)` re-declared here would satisfy every behavioural assertion below while
 *     being a SECOND representation of the rule — which is how the previous looser-twin defect happened. Only
 *     reference identity catches that.
 *  2. **The DTO IS this schema**, so the shape the `ZodValidationPipe` enforces and the shape
 *     `@kitchensink/schema-recipe` publishes cannot be two objects that merely agree today.
 *  3. **An unknown key is REJECTED**, driven through the REAL pipe rather than asserted against the schema in
 *     isolation — because what a caller experiences is the pipe's answer, and a `createZodDto` that had been
 *     pointed at a different schema would still pass a schema-only assertion.
 */
import { BadRequestException } from '@nestjs/common';
import { recipeRatingStarsSchema } from '@kitchensink/recipe-core';
import { ZodValidationPipe } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';

import { setRatingRequestSchema } from '../ratings.schema.js';
import { SetRatingDto } from '../dto/setRating.dto.js';

/** Run a body through the exact pipe an inbound request meets. */
function throughPipe(body: unknown): unknown {
    return new ZodValidationPipe().transform(body, { type: 'body', metatype: SetRatingDto });
}

describe('the stars bound is recipe-core’s Value Object, not a local copy of it', () => {
    it('IS the same object, so the 1–5 rule cannot be restated here', () => {
        expect(setRatingRequestSchema.shape.stars).toBe(recipeRatingStarsSchema);
    });

    // Identity alone would not notice `recipe-core` itself loosening the rule, so the values are asserted too.
    it.each([
        [1, true],
        [5, true],
        [3, true],
        [0, false],
        [6, false],
        [2.5, false],
        [-1, false],
    ])('stars=%s is accepted: %s', (stars, accepted) => {
        expect(setRatingRequestSchema.safeParse({ stars }).success).toBe(accepted);
    });

    it('requires the field — an empty body is not "no change"', () => {
        expect(setRatingRequestSchema.safeParse({}).success).toBe(false);
    });
});

describe('the DTO is the published schema', () => {
    it('SetRatingDto.schema IS setRatingRequestSchema', () => {
        expect((SetRatingDto as unknown as { schema: unknown }).schema).toBe(setRatingRequestSchema);
    });
});

describe('a spoofed rater id is REFUSED, where it used to be silently stripped', () => {
    /**
     * The security property was never at risk — the service takes the rater from the verified token and has
     * never read a body field — so this is about what the CALLER is told. Under the previous `z.object` the body
     * `{ stars: 5, userId: 'someone-else' }` parsed to `{ stars: 5 }` and answered `200`, which reads to the
     * caller as "both fields accepted". GR-017 §17-c's ruling makes it a `400`.
     */
    it('rejects an unknown key through the REAL pipe, not merely at the schema', () => {
        expect(() => throughPipe({ stars: 5, userId: 'someone-else' })).toThrow(BadRequestException);
    });

    it('names the refused key in the 400, so the caller can act on it', () => {
        let issues: readonly { readonly code?: string; readonly keys?: readonly string[] }[] = [];

        try {
            throughPipe({ stars: 5, userId: 'someone-else' });
        } catch (thrown) {
            const body = (thrown as BadRequestException).getResponse() as {
                errors?: readonly { readonly code?: string; readonly keys?: readonly string[] }[];
            };

            issues = body.errors ?? [];
        }

        expect(issues.flatMap((issue) => issue.keys ?? [])).toStrictEqual(['userId']);
    });

    it('still accepts the well-formed body, so the strictness did not break the endpoint', () => {
        expect(throughPipe({ stars: 4 })).toStrictEqual({ stars: 4 });
    });
});
