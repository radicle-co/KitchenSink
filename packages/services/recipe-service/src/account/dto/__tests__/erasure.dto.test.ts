/**
 * Unit tests for the `ErasureRequestDto` validation shape (CR-002 / U3b).
 *
 * The DTO validates the SHAPE of the request; the VALUE of the confirmation phrase is a domain rule in
 * `ErasureService` (tested there). Here we pin the class-validator constraints on the new per-recipe
 * DONATE election `publishRecipeIds`: OPTIONAL, an array, each entry a UUID, capped in size — so a
 * malformed election is a `400` at the pipe rather than untrusted data reaching the durable job row.
 */
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
    ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
    ACCOUNT_ERASURE_PUBLISH_WARNING,
    ErasureRequestDto,
} from '../erasure.dto.js';

const RECIPE_ID = '00000000-0000-4000-8000-0000000000d1';

const violationsFor = async (payload: Record<string, unknown>): Promise<string[]> => {
    const dto = plainToInstance(ErasureRequestDto, payload);
    const errors = await validate(dto);

    return errors.map((error) => error.property);
};

describe('ErasureRequestDto.publishRecipeIds', () => {
    it('is OPTIONAL — a request with only the phrase is valid (default: donate nothing)', async () => {
        expect(await violationsFor({ confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE })).toEqual([]);
    });

    it('accepts an array of UUIDs', async () => {
        const violations = await violationsFor({
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
            publishRecipeIds: [RECIPE_ID, '00000000-0000-4000-8000-0000000000d2'],
        });

        expect(violations).toEqual([]);
    });

    it('rejects a non-UUID election entry (never lets a raw string reach the durable row)', async () => {
        const violations = await violationsFor({
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
            publishRecipeIds: [RECIPE_ID, 'not-a-uuid'],
        });

        expect(violations).toContain('publishRecipeIds');
    });

    it('rejects a non-array election', async () => {
        const violations = await violationsFor({
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
            publishRecipeIds: RECIPE_ID,
        });

        expect(violations).toContain('publishRecipeIds');
    });

    it('rejects an election over the size cap (a payload/DoS guard, not a product limit)', async () => {
        const violations = await violationsFor({
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
            publishRecipeIds: Array.from({ length: 1001 }, () => RECIPE_ID),
        });

        expect(violations).toContain('publishRecipeIds');
    });
});

describe('ACCOUNT_ERASURE_PUBLISH_WARNING', () => {
    it('states the permanence of donating: public + unremovable by the erased owner', () => {
        // The consent copy backing the informed R8 election. Pinned so the meaning cannot silently soften.
        expect(ACCOUNT_ERASURE_PUBLISH_WARNING).toMatch(/public/i);
        expect(ACCOUNT_ERASURE_PUBLISH_WARNING).toMatch(/permanent/i);
    });
});
