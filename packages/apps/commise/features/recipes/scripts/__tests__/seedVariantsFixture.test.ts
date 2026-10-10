// @vitest-environment node
/**
 * The generated seed-variant fixture (`src/details/__fixtures__/seedVariants.ts`) against the sources it is derived
 * from, and the derivation's rules at their boundaries.
 *
 * The parity case compares MEANING, not bytes: the committed module's exports against a fresh derivation, so a Prettier
 * upgrade cannot turn it red while a seed change or a mockup change does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as committed from '../../src/details/__fixtures__/seedVariants.js';
import {
    MOCKUP_PATH,
    SEED_PATH,
    SEED_VARIANT_ROOTS,
    deriveSeedVariants,
    seedVariantsModuleText,
} from '../seedVariantsFixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../../../', import.meta.url));

/** One seed row, as the curated seed writes it. */
function seedRow(name: string, variants: readonly { item: string; parts: readonly [string, string][] }[]): string {
    return JSON.stringify({
        seedKey: `fdc:${name}`,
        name,
        synonyms: [],
        item: `fdc:${name}`,
        variants: variants.map(({ item, parts }) => ({
            item,
            parts: parts.map(([attribute, text]) => ({ attribute, text })),
        })),
    });
}

/** A mockup whose JSON island holds `entries`. */
function mockup(entries: Record<string, unknown>): string {
    return `<html><script id="seed" type="application/json">${JSON.stringify(entries)}</script></html>`;
}

const ROOT = 'boneless skinless chicken thighs';
const FRIED = { item: 'fdc:1', parts: [['cookingMethod', 'fried']] as [string, string][] };
const SOAKED_ROASTED = {
    item: 'fdc:2',
    parts: [
        ['pack', 'with added solution'],
        ['cookingMethod', 'roasted'],
    ] as [string, string][],
};

/** A seed holding every configured root, with `variants` under {@link ROOT} and one plain variant under the rest. */
function seedWith(variants: readonly { item: string; parts: readonly [string, string][] }[]): string {
    return SEED_VARIANT_ROOTS.map(({ rootName }, index) =>
        seedRow(rootName, rootName === ROOT ? variants : [{ item: `fdc:x${String(index)}`, parts: [['cut', 'any']] }]),
    ).join('\n');
}

describe('the committed fixture', () => {
    it('is what the committed seed and mockup derive, export for export', () => {
        const derived = deriveSeedVariants(
            readFileSync(join(REPO_ROOT, SEED_PATH), 'utf8'),
            readFileSync(join(REPO_ROOT, MOCKUP_PATH), 'utf8'),
        );

        expect({ ...committed }).toStrictEqual(derived);
    });
});

describe('deriveSeedVariants', () => {
    it('keeps the seed’s variants in seed order, with their items as ids and their parts as written', () => {
        const derived = deriveSeedVariants(seedWith([SOAKED_ROASTED, FRIED]), mockup({}));

        expect(derived['BONELESS_SKINLESS_CHICKEN_THIGHS']).toStrictEqual([
            {
                id: 'fdc:2',
                parts: [
                    { attribute: 'pack', text: 'with added solution' },
                    { attribute: 'cookingMethod', text: 'roasted' },
                ],
            },
            { id: 'fdc:1', parts: [{ attribute: 'cookingMethod', text: 'fried' }] },
        ]);
    });

    it.each([
        [
            'by item, when the mockup row names one',
            [
                { item: 'fdc:1', parts: ['anything'], cal: 218 },
                { item: 'fdc:2', parts: ['else'], cal: 164 },
            ],
        ],
        [
            'by the exact ordered part texts, when it names none',
            [
                { parts: ['fried'], cal: 218 },
                { parts: ['with added solution', 'roasted'], cal: 164 },
            ],
        ],
    ])('gives a root the mockup covers in full its calories, matched %s', (_label, rows) => {
        const derived = deriveSeedVariants(
            seedWith([FRIED, SOAKED_ROASTED]),
            mockup({ thighs: { food: ROOT, n: 2, groups: [{ header: null, rows }] } }),
        );

        expect(derived['BONELESS_SKINLESS_CHICKEN_THIGHS']?.map((variant) => variant.caloriesPer100g)).toStrictEqual([
            218, 164,
        ]);
    });

    it.each([
        ['covers fewer rows than its n', { n: 2, rows: [{ parts: ['fried'], cal: 218 }] }],
        ['states an n other than the seed’s count', { n: 3, rows: [{ parts: ['fried'], cal: 218 }] }],
    ])('gives no calories to a root whose mockup entry %s', (_label, { n, rows }) => {
        const derived = deriveSeedVariants(
            seedWith([FRIED, SOAKED_ROASTED]),
            mockup({ thighs: { food: ROOT, n, groups: [{ header: null, rows }] } }),
        );

        expect(derived['BONELESS_SKINLESS_CHICKEN_THIGHS']?.every((variant) => !('caloriesPer100g' in variant))).toBe(
            true,
        );
    });

    it.each([
        [
            'a row that matches no variant',
            [
                { parts: ['fried'], cal: 218 },
                { parts: ['grilled'], cal: 1 },
            ],
        ],
        [
            'two rows that match one variant',
            [
                { parts: ['fried'], cal: 218 },
                { item: 'fdc:1', parts: [], cal: 1 },
            ],
        ],
    ])('refuses a mockup entry with %s, rather than guessing', (_label, rows) => {
        expect(() =>
            deriveSeedVariants(
                seedWith([FRIED, SOAKED_ROASTED]),
                mockup({ thighs: { food: ROOT, n: 2, groups: [{ header: null, rows }] } }),
            ),
        ).toThrow(/thighs/u);
    });

    it('refuses a seed that lacks a configured root', () => {
        expect(() => deriveSeedVariants(seedRow('anything else', [FRIED]), mockup({}))).toThrow(/not in the seed/u);
    });

    it('refuses a mockup with no seed block', () => {
        expect(() => deriveSeedVariants(seedWith([FRIED]), '<html></html>')).toThrow(/seed/u);
    });
});

describe('seedVariantsModuleText', () => {
    it('declares one typed export per configured root, holding exactly its variants', () => {
        const fixtures = deriveSeedVariants(seedWith([FRIED]), mockup({}));
        const text = seedVariantsModuleText(fixtures);

        for (const { exportName } of SEED_VARIANT_ROOTS) {
            expect(text).toContain(`export const ${exportName}: readonly VariantView[] = `);
        }

        expect(text).toContain(JSON.stringify(fixtures['BONELESS_SKINLESS_CHICKEN_THIGHS']));
    });
});
