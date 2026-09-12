import { describe, expect, it } from 'vitest';

import { MalformedMigrateEventError, isMalformedMigrateEventError, parseMigrateEvent } from '../migrateEvent.js';

const SHA = 'a'.repeat(64);

describe('parseMigrateEvent', () => {
    it('accepts exactly `{ expectManifestSha }` with a well-formed digest', () => {
        expect(parseMigrateEvent({ expectManifestSha: SHA }, 'Food')).toEqual({ expectManifestSha: SHA });
    });

    it.each([
        ['an absent event', undefined],
        ['an empty event', {}],
        ['a digest that is not 64 lowercase hex', { expectManifestSha: 'A'.repeat(64) }],
        ['a misspelt key', { expectedManifestSha: SHA }],
        // `.strict()`: the runner has one action, so an extra key is a caller that thinks it selects another.
        ['an extra key', { expectManifestSha: SHA, action: 'drop' }],
    ])('⛔ refuses %s, naming the runner and the field', (_case, event) => {
        let caught: unknown;

        try {
            parseMigrateEvent(event, 'Recipe');
        } catch (error) {
            caught = error;
        }

        expect(isMalformedMigrateEventError(caught)).toBe(true);
        expect((caught as MalformedMigrateEventError).message).toMatch(
            /^Recipe migration runner received a malformed event — /u,
        );
    });

    it('describes each issue by its path, or `(root)`', () => {
        expect(() => parseMigrateEvent({ expectManifestSha: 'x' }, 'Identity')).toThrow(
            /expectManifestSha: must be a 64-character lowercase hex sha256/u,
        );
    });
});
