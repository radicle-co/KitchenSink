import { describe, expect, it } from 'vitest';

import { isUserId, newUserId } from '../ulid.js';

describe('ULID user ids', () => {
    it('creates a 26 character UserId that round-trips', () => {
        const id = newUserId();

        expect(id).toHaveLength(26);
        expect(isUserId(id)).toBe(true);
        expect(isUserId(id.toLowerCase())).toBe(true);
    });

    it('rejects invalid input', () => {
        expect(isUserId('not-a-ulid')).toBe(false);
        expect(isUserId('01ARYZ6S41TSV4RRFFQ69G5FAV')).toBe(true);
    });
});
