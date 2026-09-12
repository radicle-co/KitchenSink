/**
 * Unit tests for `NormalizedIngredientKey` — the PERSISTED match grain of the resolution knowledge base
 * (plan U10 / R14, R19, R20).
 *
 * ⛔ THIS IS A GOLDEN TABLE, AND THAT IS THE POINT. The key is data at rest: it is the column two tables are
 * indexed on and the grain corroboration counts distinct authors within. A change to the derivation
 * RE-PARTITIONS both tables — every stored key stops matching every future query — and it does so SILENTLY:
 * no error, no exception, just a knowledge base that quietly stops hitting. So the `(raw → key)` pairs below
 * are pinned exactly, and a derivation change must show up as a visible diff in this file plus a decision
 * about backfilling from the stored `source_phrase`.
 *
 * The properties, not the formatting preferences:
 *
 *  1. **Case is destroyed, so spellings COLLIDE.** That collision is the entire mechanism by which one cook's
 *     correction resolves another cook's line (R19) and by which two independent corrections corroborate each
 *     other (R20). If case survived, corroboration would silently never fire.
 *  2. **Invisible characters cannot split one identity into many.** `Bro<ZWSP>ccoli` renders as `Broccoli`;
 *     if it keyed distinctly, an attacker could mint unlimited keys that all LOOK like one phrase — which is
 *     `sanitizeFoodName`'s stated threat model reaching a second table.
 *  3. **A phrase with no visible content produces NO key.** A total constructor returning `undefined` is what
 *     lets a `400` and an unattended import's "record it unresolved" both BRANCH, instead of one of them
 *     writing a row keyed on `''` that every other contentless phrase then collides with.
 */
import { describe, expect, it } from 'vitest';

import { normalizedIngredientKey } from '../normalizedKey.js';

describe('normalizedIngredientKey — the golden table (a diff here is a re-partition of the knowledge base)', () => {
    it.each([
        ['all-purpose flour', 'all-purpose flour'],
        ['All-Purpose Flour', 'all-purpose flour'],
        ['Vinegar, red wine', 'vinegar, red wine'],
        ["confectioner's sugar", "confectioner's sugar"],
        ['Crème fraîche', 'crème fraîche'],
        ['Butter (unsalted)', 'butter (unsalted)'],
        ['  sifted   pastry flour ', 'sifted pastry flour'],
        ['red\twine\n\nvinegar', 'red wine vinegar'],
        ['ＦＬＯＵＲ', 'flour'],
    ])('keys %j as %j', (raw, expected) => {
        expect(normalizedIngredientKey(raw)).toBe(expected);
    });
});

describe('normalizedIngredientKey — case is destroyed so spellings collide', () => {
    it('keys every casing of one phrase identically', () => {
        const keys = ['Plain Flour', 'plain flour', 'PLAIN FLOUR', 'PlAiN fLoUr'].map(normalizedIngredientKey);

        expect(new Set(keys).size).toBe(1);
    });

    it('is idempotent — re-keying an already-normalized key changes nothing', () => {
        const once = normalizedIngredientKey('  Sifted   Pastry Flour ');

        expect(once).toBeDefined();
        expect(normalizedIngredientKey(once as string)).toBe(once);
    });
});

describe('normalizedIngredientKey — invisible characters cannot split one identity into many', () => {
    it('keys a zero-width-joined spelling as the phrase it renders as', () => {
        expect(normalizedIngredientKey('Bro​ccoli')).toBe(normalizedIngredientKey('Broccoli'));
    });
});

describe('normalizedIngredientKey — a phrase with no visible content produces NO key', () => {
    it.each([
        ['an empty string', ''],
        ['whitespace only', '   \t\n '],
        ['invisible characters only', '​‍﻿'],
    ])('returns undefined for %s', (_label, phrase) => {
        expect(normalizedIngredientKey(phrase)).toBeUndefined();
    });

    it('never returns the empty string, which would collide every contentless phrase onto one row', () => {
        for (const phrase of ['', ' ', '​']) {
            expect(normalizedIngredientKey(phrase)).not.toBe('');
        }
    });
});
