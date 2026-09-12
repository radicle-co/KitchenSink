/**
 * Unit tests for the `FoodSourceAdapter` boundary (T-120): the adapter registry (register / adapters /
 * priorityOf / adapterFor), the static source-priority config (`['usda']`), and the source-agnostic
 * canonical candidate shapes (`SourceCandidate`/`CanonicalCandidate` carry `externalKey`, never `fdcId`).
 *
 * Traceability: FR-ADP-1, FR-MRG-2, FR-MRG-4.
 */
import { describe, expect, it } from 'vitest';

import { SourceAdapterRegistry } from '../SourceAdapterRegistry.js';
import { isDuplicateSourceError, isUnknownSourceError } from '../foodSource.errors.js';
import {
    isWiredSourceId,
    type CanonicalCandidate,
    type FoodSourceAdapter,
    SOURCE_PRIORITY,
    sourcePriorityFrom,
    type SourceCandidate,
} from '../foodSourceAdapter.js';
import type { RegisteredSourceId } from '../sourceRegister.js';

/** A minimal stub adapter for a given source; method bodies are irrelevant to registry behavior. */
function makeStubAdapter(source: FoodSourceAdapter['source']): FoodSourceAdapter {
    return {
        source,
        searchByName: () => Promise.resolve([]),
        fetchByKey: () =>
            Promise.resolve({
                source,
                externalKey: '0',
                dataset: 'usdaSrFoundation',
                name: '',
                kind: 'generic',
                aliases: [],
                brandOwner: null,
                brandName: null,
                description: null,
                barcode: null,
                nutrients: [],
                portions: [],
                itemVersion: null,
            }),
    };
}

describe('isWiredSourceId', () => {
    it('answers true for USDA only: every other registered source is reached through the seed (R57)', () => {
        const sources: readonly RegisteredSourceId[] = ['usda', 'ciqual', 'cofid', 'cnf'];

        expect(sources.map((source) => isWiredSourceId(source))).toStrictEqual([true, false, false, false]);
    });
});

describe('SOURCE_PRIORITY', () => {
    it('lists usda as the sole, highest-priority source', () => {
        expect([...SOURCE_PRIORITY]).toEqual(['usda']);
    });
});

describe('sourcePriorityFrom (how SOURCE_PRIORITY is derived from the dataset precedence)', () => {
    const SOURCE_OF = { a1: 'a', b1: 'b', a2: 'a', c1: 'c', label: 'manufacturer' } as const;

    it.each([
        ['each source at its FIRST dataset, once', ['a1', 'b1', 'a2', 'c1'] as const, ['a', 'b', 'c'], ['a', 'b', 'c']],
        [
            'a lower dataset ahead in the list ranks its source first',
            ['b1', 'a1', 'a2'] as const,
            ['a', 'b'],
            ['b', 'a'],
        ],
        [
            'only the ranked sources, whatever else owns a dataset',
            ['a1', 'label', 'c1'] as const,
            ['c', 'a'],
            ['a', 'c'],
        ],
        ['nothing when no ranked source owns a dataset', ['label'] as const, ['a'], []],
    ])('ranks %s', (_, datasets, ranked, expected) => {
        expect(sourcePriorityFrom(datasets, SOURCE_OF, ranked)).toEqual(expected);
    });
});

describe('SourceAdapterRegistry', () => {
    it('resolves a registered adapter by its source', () => {
        const registry = new SourceAdapterRegistry();
        const usda = makeStubAdapter('usda');

        registry.register(usda);

        expect(registry.has('usda')).toBe(true);
        expect(registry.adapterFor('usda')).toBe(usda);
    });

    it('returns wired adapters in priority order', () => {
        const registry = new SourceAdapterRegistry();
        const usda = makeStubAdapter('usda');

        registry.register(usda);

        expect(registry.adapters()).toEqual([usda]);
    });

    it('rejects a duplicate registration with DuplicateSourceError', () => {
        const registry = new SourceAdapterRegistry();
        registry.register(makeStubAdapter('usda'));

        let thrown: unknown;

        try {
            registry.register(makeStubAdapter('usda'));
        } catch (error) {
            thrown = error;
        }

        expect(isDuplicateSourceError(thrown)).toBe(true);
    });

    it('throws UnknownSourceError when resolving an unregistered source', () => {
        const registry = new SourceAdapterRegistry();

        let thrown: unknown;

        try {
            registry.adapterFor('usda');
        } catch (error) {
            thrown = error;
        }

        expect(isUnknownSourceError(thrown)).toBe(true);
    });

    it('priorityOf ranks usda at the top (priority 1, the highest configured)', () => {
        const registry = new SourceAdapterRegistry();

        expect(registry.priorityOf('usda')).toBe(1);
    });
});

describe('canonical candidate shapes', () => {
    it('SourceCandidate carries externalKey and never a source-native key (fdcId)', () => {
        const candidate: SourceCandidate = {
            source: 'usda',
            externalKey: '171688',
            name: 'Broccoli, raw',
            lineageKey: null,
        };

        expect(candidate.externalKey).toBe('171688');
        expect(Object.keys(candidate)).not.toContain('fdcId');
    });

    it('CanonicalCandidate carries externalKey + per-100g nutrients and never fdcId', () => {
        const candidate: CanonicalCandidate = {
            source: 'usda',
            externalKey: '171688',
            dataset: 'usdaSrFoundation',
            name: 'Broccoli, raw',
            kind: 'generic',
            brandOwner: null,
            brandName: null,
            description: 'Broccoli, raw',
            barcode: null,
            aliases: ['broccoli florets'],
            nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' }],
            portions: [{ label: '1 cup chopped', gramWeight: '91' }],
            itemVersion: '2021-10-28',
        };

        expect(candidate.externalKey).toBe('171688');
        expect(candidate.nutrients[0]?.basis).toBe('per_100g');
        expect(Object.keys(candidate)).not.toContain('fdcId');
    });
});
