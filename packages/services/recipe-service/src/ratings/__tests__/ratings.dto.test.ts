/**
 * The rating write DTO, driven through the real {@link ZodValidationPipe} that runs on an inbound request.
 *
 * The SECURITY property under test is unknown-key REJECTION (it was a strip until GR-017 §17-c): the rater is
 * always the verified bearer, so a
 * body carrying `userId` must never reach the service. `class-validator`'s `whitelist: true` used to
 * provide that; zod's `z.object` strips by default, and the test below is what proves the guarantee
 * survived the swap rather than being assumed to.
 */
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ArgumentMetadata } from '@nestjs/common';

import { SetRatingDto } from '../dto/setRating.dto.js';
import { setRatingRequestSchema } from '../ratings.schema.js';

const pipe = new ZodValidationPipe();

/** Run a body through the real pipe for {@link SetRatingDto}. */
function transform(body: unknown): unknown {
    return pipe.transform(body, { type: 'body', metatype: SetRatingDto } as ArgumentMetadata);
}

/** The HTTP status a rejected body produces, or `undefined` when the body was accepted. */
function statusOfRejection(body: unknown): number | undefined {
    try {
        transform(body);

        return undefined;
    } catch (error: unknown) {
        return (error as { getStatus: () => number }).getStatus();
    }
}

describe('SetRatingDto', () => {
    it('IS the published rating-request schema, which is recipe-core’s single rating rule', () => {
        expect(SetRatingDto.schema).toBe(setRatingRequestSchema);
    });

    it.each([1, 2, 3, 4, 5])('accepts %i whole stars', (stars) => {
        expect(transform({ stars })).toEqual({ stars });
    });

    // Was a STRIP assertion. The body is `z.strictObject` per GR-017 §17-c, so a spoofed rater id is a `400`.
    // The guarantee itself is unchanged and does not depend on either behaviour: the rater is taken from the
    // verified bearer token and no body field is ever read. See `../__tests__/ratings.schema.test.ts`, which
    // also asserts the `400` NAMES `userId`.
    it('REFUSES a spoofed rater id, so a caller learns the field was rejected', () => {
        expect(() => transform({ stars: 4, userId: 'someone-elses-ulid' })).toThrow();
    });

    it.each([
        ['zero stars', { stars: 0 }],
        ['six stars', { stars: 6 }],
        ['half a star', { stars: 3.5 }],
        ['a negative rating', { stars: -1 }],
        ['a string rating', { stars: '4' }],
        ['no rating at all', {}],
    ])('rejects %s with 400', (_case, body) => {
        expect(statusOfRejection(body)).toBe(400);
    });
});
