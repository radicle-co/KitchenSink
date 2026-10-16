/**
 * Contract pin: the code the erasure path EMITS on `410` is a member of the published error-code enum.
 *
 * The service once sent `ALREADY_ERASED` while `recipeErrorCodeSchema` (and the client's `switch`) named
 * `ACCOUNT_ALREADY_ERASED`; every per-side test asserted its own constant, so nothing failed. The schema is
 * authoritative (ADR-0014), so this test reads the emitted constant against the schema, not against a literal.
 */
import { describe, expect, it } from 'vitest';

import { ACCOUNT_ALREADY_ERASED_CODE } from '@kitchensink/recipe-core';

import { recipeApiErrorSchema, recipeErrorCodeSchema } from '../../common/apiError.schema.js';

describe('erasure 410 error code', () => {
    it('is a member of the published error-code enum', () => {
        expect(recipeErrorCodeSchema.safeParse(ACCOUNT_ALREADY_ERASED_CODE).success).toBe(true);
    });

    it('parses as a published API error body', () => {
        const body = { code: ACCOUNT_ALREADY_ERASED_CODE, message: 'Account has already been erased' };
        expect(recipeApiErrorSchema.safeParse(body).success).toBe(true);
    });
});
