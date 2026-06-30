/**
 * Unit tests for the pure golden-record merge engine (T-160) + the survivor-count auto-resolve
 * boundary (T-162) + merge-boundary sanitization (T-164). Each merge rule is asserted independently:
 * presence-beats-absence, identity/short-field-takes-priority-source (NOT longest), free-text
 * longer-wins, conflicting-nutrient-takes-priority-source, and all-per-100g-before-blend. The engine
 * is generic over the source-id type so priority conflicts can be modelled with two synthetic sources.
 *
 * Traceability: FR-MRG-1, FR-MRG-2, FR-MRG-3, FR-MRG-5, FR-RES-3, FR-ADP-2, FR-ADP-3.
 */
import { describe, expect, it } from 'vitest';

import { mergeCandidates, normalizeName } from '../merge-engine.js';
import { sanitizeCandidates } from '../merge-sanitize.js';
import { makeMergeCandidate } from '../__fixtures__/merge.fixtures.js';

/** Two synthetic sources for priority tests: `usda` ranks higher than `other`. */
type TestSource = 'usda' | 'other';

/** `usda` (2) outranks `other` (1) — mirrors the registry's higher-number-wins contract. */
const priorityOf = (source: TestSource): number => (source === 'usda' ? 2 : 1);

/** All-equal priority resolver for single-source blends (two `usda` items of the same food). */
const flatPriority = (): number => 1;

describe('normalizeName', () => {
    it('lowercases, trims, and collapses internal whitespace (the dedup grain)', () => {
        expect(normalizeName('  Broccoli,   RAW ')).toBe('broccoli, raw');
    });
});

describe('mergeCandidates — survivor-count auto-resolve boundary (FR-MRG-5)', () => {
    it('0 candidates → NOT_FOUND with no golden record', () => {
        const result = mergeCandidates<TestSource>([], priorityOf);

        expect(result.outcome).toBe('NOT_FOUND');
        expect(result.goldenRecord).toBeNull();
        expect(result.candidateSet).toEqual([]);
    });

    it('exactly 1 survivor after normalized-name exact match → RESOLVED', () => {
        const result = mergeCandidates<TestSource>([makeMergeCandidate<TestSource>('usda')], priorityOf);

        expect(result.outcome).toBe('RESOLVED');
        expect(result.goldenRecord).not.toBeNull();
    });

    it('two same-name candidates collapse to 1 survivor → RESOLVED (pre-merge dedup)', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', { externalKey: 'A', name: 'Broccoli, raw' }),
                makeMergeCandidate<TestSource>('other', { externalKey: 'B', name: 'broccoli,  RAW' }),
            ],
            priorityOf,
        );

        expect(result.outcome).toBe('RESOLVED');
    });

    it('>1 distinct survivor → UNRESOLVED with the full surviving candidate set (bias to human)', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', { externalKey: 'A', name: 'Broccoli, raw' }),
                makeMergeCandidate<TestSource>('usda', { externalKey: 'B', name: 'Broccoli, cooked' }),
            ],
            priorityOf,
        );

        expect(result.outcome).toBe('UNRESOLVED');
        expect(result.goldenRecord).toBeNull();
        expect(result.candidateSet).toHaveLength(2);
        expect(result.candidateSet.map((candidate) => candidate.externalKey).sort()).toEqual(['A', 'B']);
    });
});

describe('mergeCandidates — field-level merge rules (FR-MRG-2/FR-MRG-3)', () => {
    it('presence beats absence: a field present on only one contributor fills the golden record', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', { externalKey: 'A', description: null, brandOwner: 'Acme' }),
                makeMergeCandidate<TestSource>('other', {
                    externalKey: 'B',
                    description: 'Raw broccoli florets',
                    brandOwner: null,
                }),
            ],
            priorityOf,
        );

        expect(result.goldenRecord?.brandOwner?.value).toBe('Acme');
        expect(result.goldenRecord?.brandOwner?.source).toBe('usda');
        expect(result.goldenRecord?.description?.value).toBe('Raw broccoli florets');
        expect(result.goldenRecord?.description?.source).toBe('other');
    });

    it('identity/short field (brand_owner) takes the HIGHER-PRIORITY source, NOT the longest value', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', { externalKey: 'A', brandOwner: 'Acme' }),
                makeMergeCandidate<TestSource>('other', {
                    externalKey: 'B',
                    brandOwner: 'International Dairy Conglomerate Holdings',
                }),
            ],
            priorityOf,
        );

        // The longer value belongs to the lower-priority source; priority must win for identity fields.
        expect(result.goldenRecord?.brandOwner?.value).toBe('Acme');
        expect(result.goldenRecord?.brandOwner?.source).toBe('usda');
    });

    it('free-text field (description) takes the LONGER value even from a lower-priority source', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', { externalKey: 'A', description: 'Broccoli.' }),
                makeMergeCandidate<TestSource>('other', {
                    externalKey: 'B',
                    description: 'Raw broccoli, chopped, including stalks and florets.',
                }),
            ],
            priorityOf,
        );

        expect(result.goldenRecord?.description?.value).toBe('Raw broccoli, chopped, including stalks and florets.');
        expect(result.goldenRecord?.description?.source).toBe('other');
    });

    it('conflicting nutrient (same code) takes the higher-priority source and tags its winning source', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', {
                    externalKey: 'A',
                    nutrients: [{ code: 'ENERC_KCAL', name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' }],
                }),
                makeMergeCandidate<TestSource>('other', {
                    externalKey: 'B',
                    nutrients: [{ code: 'ENERC_KCAL', name: 'Energy', unit: 'kcal', amount: '40', basis: 'per_100g' }],
                }),
            ],
            priorityOf,
        );

        const energy = result.goldenRecord?.nutrients.find((nutrient) => nutrient.code === 'ENERC_KCAL');
        expect(energy?.amount).toBe('34');
        expect(energy?.source).toBe('usda');
    });

    it('per_100g wins over per_serving on a same-nutrient conflict, even from a lower-priority source (D-PERSERVING)', () => {
        const result = mergeCandidates<TestSource>(
            [
                // Higher priority, but per_serving — per_100g is the normalized basis and wins the golden value.
                makeMergeCandidate<TestSource>('usda', {
                    externalKey: 'A',
                    nutrients: [{ code: 'PROCNT', name: 'Protein', unit: 'g', amount: '5', basis: 'per_serving' }],
                }),
                // Lower priority but a per_100g value — must win because per_100g beats per_serving on conflict.
                makeMergeCandidate<TestSource>('other', {
                    externalKey: 'B',
                    nutrients: [{ code: 'PROCNT', name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' }],
                }),
            ],
            priorityOf,
        );

        const protein = result.goldenRecord?.nutrients.find((nutrient) => nutrient.code === 'PROCNT');
        expect(protein?.amount).toBe('2.8');
        expect(protein?.basis).toBe('per_100g');
        expect(protein?.source).toBe('other');
    });

    it('RETAINS a per_serving-only nutrient (no per_100g counterpart) with basis=per_serving (D-PERSERVING)', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', {
                    externalKey: 'A',
                    nutrients: [{ code: 'PROCNT', name: 'Protein', unit: 'g', amount: '8', basis: 'per_serving' }],
                }),
            ],
            priorityOf,
        );

        const protein = result.goldenRecord?.nutrients.find((nutrient) => nutrient.code === 'PROCNT');
        expect(protein).toBeDefined();
        expect(protein?.amount).toBe('8');
        expect(protein?.basis).toBe('per_serving');
        expect(protein?.source).toBe('usda');
    });

    it('unions portions across contributors, each tagged with its own source', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', {
                    externalKey: 'A',
                    portions: [{ label: '1 cup chopped', gramWeight: '91' }],
                }),
                makeMergeCandidate<TestSource>('other', {
                    externalKey: 'B',
                    portions: [{ label: '1 spear', gramWeight: '31' }],
                }),
            ],
            flatPriority,
        );

        expect(result.goldenRecord?.portions).toHaveLength(2);
        expect(result.goldenRecord?.portions.map((portion) => portion.label).sort()).toEqual([
            '1 cup chopped',
            '1 spear',
        ]);
    });

    it('lists every contributor as a contributing source (so each value has a crosswalk to stamp)', () => {
        const result = mergeCandidates<TestSource>(
            [
                makeMergeCandidate<TestSource>('usda', { externalKey: 'A' }),
                makeMergeCandidate<TestSource>('other', { externalKey: 'B' }),
            ],
            flatPriority,
        );

        expect(result.goldenRecord?.contributingSources.map((source) => source.externalKey).sort()).toEqual(['A', 'B']);
    });
});

describe('sanitizeCandidates — reject-not-store at the merge boundary (T-164, FR-ADP-2/FR-ADP-3)', () => {
    it('drops a malformed nutrient value but keeps the candidate and its valid values', () => {
        const [clean] = sanitizeCandidates([
            makeMergeCandidate('usda', {
                nutrients: [
                    { code: null, name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' },
                    { code: null, name: 'BadFat', unit: 'g', amount: '-7', basis: 'per_100g' },
                    { code: null, name: 'NaNCarb', unit: 'g', amount: 'abc', basis: 'per_100g' },
                ],
                portions: [
                    { label: '1 cup', gramWeight: '91' },
                    { label: 'bad', gramWeight: '0' },
                ],
            }),
        ]);

        expect(clean?.nutrients.map((nutrient) => nutrient.name)).toEqual(['Protein']);
        expect(clean?.portions.map((portion) => portion.label)).toEqual(['1 cup']);
    });

    it('drops a whole candidate that has no usable name (food still resolves from the rest)', () => {
        const clean = sanitizeCandidates([
            makeMergeCandidate('usda', { externalKey: 'A', name: '   ' }),
            makeMergeCandidate('usda', { externalKey: 'B', name: 'Broccoli, raw' }),
        ]);

        expect(clean).toHaveLength(1);
        expect(clean[0]?.externalKey).toBe('B');
    });
});
