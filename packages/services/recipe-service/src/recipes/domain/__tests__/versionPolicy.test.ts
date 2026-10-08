/**
 * Unit tests for {@link recordsVersion} — whether a recipe write records a `recipe_versions` row (ADR-0058).
 *
 * The rule keys on the persisted `first_published_at` fact, never on `status`. The row a published recipe that was
 * set back to draft is the case a status-keyed rule gets wrong: it would overwrite published history in place.
 */
import { describe, expect, it } from 'vitest';

import { recordsVersion } from '../versionPolicy.js';

const PUBLISHED_AT = new Date('2026-10-01T12:00:00.000Z');

describe('recordsVersion', () => {
    it.each([
        ['a draft that was never published', { status: 'draft', firstPublishedAt: null }, false],
        ['a published recipe', { status: 'published', firstPublishedAt: PUBLISHED_AT }, true],
        ['a published recipe set back to draft', { status: 'draft', firstPublishedAt: PUBLISHED_AT }, true],
    ] as const)('%s → %s', (_label, recipe, expected) => {
        expect(recordsVersion(recipe)).toBe(expected);
    });
});
