/**
 * The erasure request DTO is the AUTHORED zod contract, wired into Nest through `nestjs-zod`'s
 * `createZodDto`. These tests drive the REAL {@link ZodValidationPipe} — the one an inbound request goes
 * through — because a schema that is correct but unwired validates nothing.
 *
 * They REPLACE the `class-validator` version of this suite, which called `validate()` on a decorated class and
 * asserted the offending property NAME. Every case it covered survives here, re-expressed against the pipe's
 * actual outcome (accepted, or a `BadRequestException`), which is what a client sees. Three properties carry
 * most of the value:
 *
 *  1. **The DTO and the published schema are the SAME object** (`ErasureRequestDto.schema === erasureRequestSchema`).
 *     `@kitchensink/schema-recipe` publishes that schema verbatim, so identity makes it impossible to validate
 *     one shape and publish another — which on an IRREVERSIBLE endpoint is the difference that matters.
 *  2. **The pipe does NOT check the phrase's VALUE.** That is `ErasureService`'s gate, deliberately: the pipe
 *     runs before the controller and does not run at all for a bodyless request. The
 *     `accepts a well-formed but WRONG phrase` case exists to RED the build if someone narrows the schema to a
 *     literal — see `../../account.schema.ts` note 2 for the three reasons that would be a regression.
 *  3. **`ownerId` is REFUSED, not honoured.** It could never redirect the erasure (the owner comes from the
 *     verified token); it was STRIPPED until GR-017 §17-c made an unknown key on a mutating body a `400`. The
 *     defence in depth survives either way — what the ruling adds is that the caller of an IRREVERSIBLE
 *     operation is told the field was rejected.
 */
import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ArgumentMetadata } from '@nestjs/common';

import {
    ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
    ACCOUNT_ERASURE_PUBLISH_WARNING,
    ErasureRequestDto,
    MAX_CONFIRMATION_PHRASE_LENGTH,
    MAX_PUBLISH_ELECTION_SIZE,
} from '../erasure.dto.js';
import { erasureRequestSchema } from '../../account.schema.js';

const pipe = new ZodValidationPipe();
const RECIPE_ID = '00000000-0000-4000-8000-0000000000d1';
const ANOTHER_RECIPE_ID = '00000000-0000-4000-8000-0000000000d2';

/** Run a body through the exact pipe the `AccountController` applies (`@UsePipes(ZodValidationPipe)`). */
function transform(value: unknown): unknown {
    return pipe.transform(value, { type: 'body', metatype: ErasureRequestDto } as ArgumentMetadata);
}

/** Whether the pipe ACCEPTED the body. */
function accepts(value: unknown): boolean {
    try {
        transform(value);

        return true;
    } catch {
        return false;
    }
}

describe('ErasureRequestDto', () => {
    it('IS the published erasure-request schema, so an irreversible endpoint cannot be validated one way and published another', () => {
        expect(ErasureRequestDto.schema).toBe(erasureRequestSchema);
    });

    it('rejects a body with no confirmationPhrase — the intent gate is not optional', () => {
        expect(() => transform({})).toThrow(BadRequestException);
    });

    it('rejects an EMPTY confirmationPhrase', () => {
        expect(() => transform({ confirmationPhrase: '' })).toThrow(BadRequestException);
    });

    it('rejects a confirmationPhrase over the length cap — a confirmation, not a payload', () => {
        expect(accepts({ confirmationPhrase: 'x'.repeat(MAX_CONFIRMATION_PHRASE_LENGTH + 1) })).toBe(false);
        expect(accepts({ confirmationPhrase: 'x'.repeat(MAX_CONFIRMATION_PHRASE_LENGTH) })).toBe(true);
    });

    it('accepts a well-formed but WRONG phrase — the VALUE is ErasureService’s gate, not the pipe’s', () => {
        // ⚠️ If this starts failing, someone narrowed the schema to `z.literal(...)`. That moves the intent
        // gate out of the only layer that also runs for a BODYLESS request, changes the 400 body, and
        // publishes the phrase as an enum in openapi.yaml. See ../../account.schema.ts note 2.
        expect(transform({ confirmationPhrase: 'delete everything please' })).toEqual({
            confirmationPhrase: 'delete everything please',
        });
    });

    // Was a STRIP assertion. The body is `z.strictObject` per GR-017 §17-c, so it is a `400`. Erasure remains
    // scoped to the verified caller under both behaviours — the owner comes from the token and no body field is
    // read — but on an IRREVERSIBLE operation the caller must be told their field was refused, not left to infer
    // it from a `202`.
    it('REFUSES an ownerId a client tried to smuggle in — erasure is only ever scoped to the caller', () => {
        expect(() =>
            transform({ confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE, ownerId: 'victim-2' }),
        ).toThrow();
    });
});

describe('ErasureRequestDto.publishRecipeIds', () => {
    it('is OPTIONAL — a request with only the phrase is valid (default: donate nothing)', () => {
        expect(transform({ confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE })).toEqual({
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
        });
    });

    it('accepts an array of UUIDs', () => {
        const body = {
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
            publishRecipeIds: [RECIPE_ID, ANOTHER_RECIPE_ID],
        };

        expect(transform(body)).toEqual(body);
    });

    it('accepts an EMPTY array — an explicit "donate nothing" is not the same statement as omitting it', () => {
        const body = { confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE, publishRecipeIds: [] };

        expect(transform(body)).toEqual(body);
    });

    it('rejects a non-UUID election entry (never lets a raw string reach the durable row)', () => {
        expect(
            accepts({
                confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
                publishRecipeIds: [RECIPE_ID, 'not-a-uuid'],
            }),
        ).toBe(false);
    });

    it('rejects a non-array election', () => {
        expect(accepts({ confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE, publishRecipeIds: RECIPE_ID })).toBe(
            false,
        );
    });

    it('rejects an election over the size cap (a payload/DoS guard, not a product limit)', () => {
        expect(
            accepts({
                confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
                publishRecipeIds: Array.from({ length: MAX_PUBLISH_ELECTION_SIZE + 1 }, () => RECIPE_ID),
            }),
        ).toBe(false);
    });

    it('accepts an election exactly AT the cap, so the bound is inclusive and an off-by-one would fail', () => {
        expect(
            accepts({
                confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
                publishRecipeIds: Array.from({ length: MAX_PUBLISH_ELECTION_SIZE }, () => RECIPE_ID),
            }),
        ).toBe(true);
    });
});

describe('ACCOUNT_ERASURE_PUBLISH_WARNING', () => {
    it('states the permanence of donating: public + unremovable by the erased owner', () => {
        // The consent copy backing the informed R8 election. Pinned so the meaning cannot silently soften.
        expect(ACCOUNT_ERASURE_PUBLISH_WARNING).toMatch(/public/i);
        expect(ACCOUNT_ERASURE_PUBLISH_WARNING).toMatch(/permanent/i);
    });
});
