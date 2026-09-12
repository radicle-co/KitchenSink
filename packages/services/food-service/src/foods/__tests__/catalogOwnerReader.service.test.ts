/**
 * The catalog owner reader (curated plan U8 S4, R19): a source item key → the live catalog root or variant that owns
 * it, else the seed root that cites it exactly, following forwards to a live ref.
 *
 * Unit tier over doubled DAOs. The SQL of each DAO is the LOCAL e2e tier's job
 * (`tests/e2e/catalogOwnerReader.e2e.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

import { makeFoodRefFacts } from '../__fixtures__/foodRefFacts.js';
import { CatalogOwnerReader, type SourceKeyRef } from '../catalogOwnerReader.service.js';
import type { FoodRefFacts } from '../dao/food.dao.js';
import type { ForwardOutcome } from '../dao/foodForward.dao.js';
import type { ItemOwner, LineageHolder } from '../dao/foodSources.dao.js';
import type { VariantFacts } from '../dao/foodVariant.dao.js';
import { FoodMetrics } from '../../observability/emfMetrics.js';

interface World {
    readonly owners?: readonly ItemOwner[];
    readonly citing?: ReadonlyMap<string, string>;
    readonly lineage?: readonly LineageHolder[];
    readonly forwards?: ReadonlyMap<string, ForwardOutcome>;
    readonly variants?: readonly VariantFacts[];
    readonly roots?: readonly FoodRefFacts[];
}

/** The reader over a world of doubled DAOs, and the spies a case asserts on. */
function makeReader(world: World): {
    reader: CatalogOwnerReader;
    citingSeedRoots: ReturnType<typeof vi.fn>;
    ownersOfLineage: ReturnType<typeof vi.fn>;
    readRefFacts: ReturnType<typeof vi.fn>;
    readFacts: ReturnType<typeof vi.fn>;
    follow: ReturnType<typeof vi.fn>;
    sink: ReturnType<typeof vi.fn>;
} {
    const ownersOf = vi.fn(async () => [...(world.owners ?? [])]);
    const citingSeedRoots = vi.fn(async (_source: string, keys: readonly string[]) => {
        return new Map([...(world.citing ?? new Map<string, string>())].filter(([key]) => keys.includes(key)));
    });
    const ownersOfLineage = vi.fn(async (_source: string, lineageKeys: readonly string[]) =>
        (world.lineage ?? []).filter((holder) => lineageKeys.includes(holder.lineageKey)),
    );
    const follow = vi.fn(async (ids: readonly string[]) => {
        return new Map(
            ids.map((id): [string, ForwardOutcome] => [
                id,
                world.forwards?.get(id) ?? { resolved: true, id, kind: undefined, hops: 0 },
            ]),
        );
    });
    const readFacts = vi.fn(async (ids: readonly string[]) =>
        (world.variants ?? []).filter((variant) => ids.includes(variant.id)),
    );
    const readRefFacts = vi.fn(async (ids: readonly string[]) =>
        (world.roots ?? []).filter((root) => ids.includes(root.id)),
    );
    const sink = vi.fn();
    const reader = new CatalogOwnerReader(
        { ownersOf, citingSeedRoots, ownersOfLineage },
        { follow },
        { readFacts },
        { readRefFacts },
        new FoodMetrics(sink),
    );

    return { reader, citingSeedRoots, ownersOfLineage, readRefFacts, readFacts, follow, sink };
}

/**
 * Keys as the adapter yields them, with no lineage.
 *
 * @param externalKeys - The keys.
 * @returns Each key with a `null` lineage key.
 */
function keys(...externalKeys: string[]): SourceKeyRef[] {
    return externalKeys.map((externalKey) => ({ externalKey, lineageKey: null }));
}

const BRISKET = makeFoodRefFacts({ id: 'R-brisket', name: 'beef brisket' });
const FLAT: VariantFacts = {
    id: 'V-flat',
    rootId: 'R-brisket',
    retired: false,
    parts: [{ attribute: 'cut', ordinal: 0, text: 'flat' }],
};

describe('CatalogOwnerReader.ownersOfKeys', () => {
    it('maps a key to the root that owns its item, with the root’s name', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: '174531', kind: 'root', id: 'R-brisket', seedOwned: true }],
            roots: [BRISKET],
        });

        expect(await reader.ownersOfKeys('usda', keys('174531'))).toStrictEqual(
            new Map([
                [
                    '174531',
                    {
                        kind: 'root',
                        id: 'R-brisket',
                        rootId: 'R-brisket',
                        rootName: 'beef brisket',
                        seedOwned: true,
                        parts: [],
                    },
                ],
            ]),
        );
    });

    it('maps a key to the variant that owns its item, under its root', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: '174532', kind: 'variant', id: 'V-flat', seedOwned: true }],
            variants: [FLAT],
            roots: [BRISKET],
        });

        expect((await reader.ownersOfKeys('usda', keys('174532'))).get('174532')).toStrictEqual({
            kind: 'variant',
            id: 'V-flat',
            rootId: 'R-brisket',
            rootName: 'beef brisket',
            seedOwned: true,
            parts: FLAT.parts,
        });
    });

    it('⛔ R19: an item’s OWNER beats a seed root that cites it as a stand-in', async () => {
        const { reader, citingSeedRoots } = makeReader({
            owners: [{ externalKey: '174531', kind: 'root', id: 'R-brisket', seedOwned: true }],
            citing: new Map([['174531', 'R-stand-in']]),
            roots: [BRISKET, makeFoodRefFacts({ id: 'R-stand-in', name: 'pastrami' })],
        });

        expect((await reader.ownersOfKeys('usda', keys('174531'))).get('174531')?.id).toBe('R-brisket');
        expect(citingSeedRoots).not.toHaveBeenCalled();
    });

    it('maps a key no item owns to the seed root the DAO answers as citing it exactly', async () => {
        const { reader, citingSeedRoots } = makeReader({
            citing: new Map([['999', 'R-crust']]),
            roots: [makeFoodRefFacts({ id: 'R-crust', name: 'pizza crust' })],
        });

        expect((await reader.ownersOfKeys('usda', keys('999'))).get('999')).toStrictEqual({
            kind: 'root',
            id: 'R-crust',
            rootId: 'R-crust',
            rootName: 'pizza crust',
            seedOwned: true,
            parts: [],
        });
        expect(citingSeedRoots).toHaveBeenCalledWith('usda', ['999']);
    });

    it('follows a retired owner’s forward to its live target', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-old', seedOwned: true }],
            forwards: new Map([['R-old', { resolved: true, id: 'V-flat', kind: 'variant', hops: 1 }]]),
            variants: [FLAT],
            roots: [makeFoodRefFacts({ id: 'R-old', retired: true }), BRISKET],
        });

        expect((await reader.ownersOfKeys('usda', keys('1'))).get('1')).toMatchObject({
            kind: 'variant',
            id: 'V-flat',
            rootId: 'R-brisket',
            rootName: 'beef brisket',
        });
    });

    // A forward redirects only a RETIRED ref, as the resolver's `refTargetOf` does; otherwise search and `GET /{id}`
    // would give one id two answers.
    it('⛔ ignores a forward from a LIVE owner, root or variant', async () => {
        const { reader, follow } = makeReader({
            owners: [
                { externalKey: '1', kind: 'root', id: 'R-brisket', seedOwned: false },
                { externalKey: '2', kind: 'variant', id: 'V-flat', seedOwned: true },
            ],
            forwards: new Map([
                ['R-brisket', { resolved: true, id: 'R-hijack', kind: 'root', hops: 1 }],
                ['V-flat', { resolved: true, id: 'R-hijack', kind: 'root', hops: 1 }],
            ]),
            variants: [FLAT],
            roots: [BRISKET, makeFoodRefFacts({ id: 'R-hijack', name: 'hijack' })],
        });

        const owners = await reader.ownersOfKeys('usda', keys('1', '2'));

        expect(Object.fromEntries([...owners].map(([key, owner]) => [key, owner.id]))).toStrictEqual({
            '1': 'R-brisket',
            '2': 'V-flat',
        });
        expect(follow).not.toHaveBeenCalledWith(expect.arrayContaining(['R-brisket']));
        expect(follow).not.toHaveBeenCalledWith(expect.arrayContaining(['V-flat']));
    });

    it('⛔ answers nothing for a forward chain that never resolves, and records it — never a 500', async () => {
        const { reader, sink } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-loop', seedOwned: true }],
            forwards: new Map([['R-loop', { resolved: false, reason: 'cycle' }]]),
            roots: [makeFoodRefFacts({ id: 'R-loop', retired: true })],
        });

        expect(await reader.ownersOfKeys('usda', keys('1'))).toStrictEqual(new Map());
        expect(sink).toHaveBeenCalledTimes(1);
        expect(String(sink.mock.calls[0]?.[0])).toContain('food-forward-unresolved');
    });

    it('answers nothing for a retired root with no forward', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-gone', seedOwned: true }],
            roots: [makeFoodRefFacts({ id: 'R-gone', retired: true })],
        });

        expect(await reader.ownersOfKeys('usda', keys('1'))).toStrictEqual(new Map());
    });

    // db-arch-1 U8 review, finding 4: `unowned` was computed before liveness, so a dead owner still counted as an owner
    // and hid the seed root that cites the key. 0018 lets a seed-keyed root retire with no forward.
    it('falls through to the citing seed root when the owner retired with no forward', async () => {
        const { reader, citingSeedRoots } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-gone', seedOwned: true }],
            citing: new Map([['1', 'R-crust']]),
            roots: [
                makeFoodRefFacts({ id: 'R-gone', retired: true }),
                makeFoodRefFacts({ id: 'R-crust', name: 'pizza crust' }),
            ],
        });

        expect((await reader.ownersOfKeys('usda', keys('1'))).get('1')).toStrictEqual({
            kind: 'root',
            id: 'R-crust',
            rootId: 'R-crust',
            rootName: 'pizza crust',
            seedOwned: true,
            parts: [],
        });
        expect(citingSeedRoots).toHaveBeenCalledWith('usda', ['1']);
    });

    it('asks for a stand-in only for the keys whose owner is dead', async () => {
        const { reader, citingSeedRoots } = makeReader({
            owners: [
                { externalKey: '1', kind: 'root', id: 'R-gone', seedOwned: true },
                { externalKey: '2', kind: 'root', id: 'R-brisket', seedOwned: true },
            ],
            citing: new Map([
                ['1', 'R-crust'],
                ['2', 'R-stand-in'],
            ]),
            roots: [
                makeFoodRefFacts({ id: 'R-gone', retired: true }),
                BRISKET,
                makeFoodRefFacts({ id: 'R-crust', name: 'pizza crust' }),
                makeFoodRefFacts({ id: 'R-stand-in', name: 'pastrami' }),
            ],
        });

        const owners = await reader.ownersOfKeys('usda', keys('1', '2'));

        expect(Object.fromEntries([...owners].map(([key, owner]) => [key, owner.id]))).toStrictEqual({
            '1': 'R-crust',
            '2': 'R-brisket',
        });
        expect(citingSeedRoots).toHaveBeenCalledTimes(1);
        expect(citingSeedRoots).toHaveBeenCalledWith('usda', ['1']);
    });

    it('answers nothing for an authored owner — the reader is catalog-only', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-mine', seedOwned: false }],
            roots: [makeFoodRefFacts({ id: 'R-mine', userId: 'U-1', visibility: 'private' })],
        });

        expect(await reader.ownersOfKeys('usda', keys('1'))).toStrictEqual(new Map());
    });

    it('reads nothing for no keys', async () => {
        const { reader, citingSeedRoots } = makeReader({});

        expect(await reader.ownersOfKeys('usda', keys())).toStrictEqual(new Map());
        expect(citingSeedRoots).not.toHaveBeenCalled();
    });
});

/**
 * What remote search hides and the adopt command refuses (ADR-0055 point 4): a key the catalog holds, and a key whose
 * item the catalog retired with no forward. Both answers come from the one reader, so "held" has one definition.
 */
describe('CatalogOwnerReader.standingOfKeys', () => {
    it('answers a held key with its owner, a retired one as retired, and an unknown one as neither', async () => {
        const { reader } = makeReader({
            owners: [
                { externalKey: 'held', kind: 'root', id: 'R-brisket', seedOwned: true },
                { externalKey: 'retired', kind: 'root', id: 'R-gone', seedOwned: true },
            ],
            roots: [BRISKET, makeFoodRefFacts({ id: 'R-gone', retired: true })],
        });

        const standing = await reader.standingOfKeys('usda', keys('held', 'retired', 'unknown'));

        expect([...standing.owners.keys()]).toStrictEqual(['held']);
        expect(standing.owners.get('held')?.rootId).toBe('R-brisket');
        expect(standing.retired).toStrictEqual(new Set(['retired']));
    });

    it('answers a chain that never resolves as retired', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: 'loop', kind: 'root', id: 'R-loop', seedOwned: true }],
            forwards: new Map([['R-loop', { resolved: false, reason: 'cycle' }]]),
            roots: [makeFoodRefFacts({ id: 'R-loop', retired: true })],
        });

        expect((await reader.standingOfKeys('usda', keys('loop'))).retired).toStrictEqual(new Set(['loop']));
    });

    it('answers a dead owner’s key that a seed root still cites as held by that root, never as retired', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-gone', seedOwned: true }],
            citing: new Map([['1', 'R-crust']]),
            roots: [
                makeFoodRefFacts({ id: 'R-gone', retired: true }),
                makeFoodRefFacts({ id: 'R-crust', name: 'pizza crust' }),
            ],
        });

        const standing = await reader.standingOfKeys('usda', keys('1'));

        expect(standing.owners.get('1')?.rootId).toBe('R-crust');
        expect(standing.retired).toStrictEqual(new Set());
    });

    it('answers a key with a live forward as held by the forward’s target', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-old', seedOwned: true }],
            forwards: new Map([['R-old', { resolved: true, id: 'R-brisket', kind: 'root', hops: 1 }]]),
            roots: [makeFoodRefFacts({ id: 'R-old', retired: true }), BRISKET],
        });

        const standing = await reader.standingOfKeys('usda', keys('1'));

        expect(standing.owners.get('1')?.rootId).toBe('R-brisket');
        expect(standing.retired).toStrictEqual(new Set());
    });
});

// Curated plan R19: USDA gives an updated Foundation food a new FDC id and keeps its NDB number, which the adapter
// hands over as the hit's lineage key. A hit on a key the seed does not hold yet still answers as the seed's entry.
describe('CatalogOwnerReader.ownersOfKeys — lineage', () => {
    const BROCCOLI = makeFoodRefFacts({ id: 'R-broccoli', name: 'broccoli' });
    const holder = (overrides: Partial<LineageHolder> = {}): LineageHolder => ({
        lineageKey: 'foundation:11090',
        externalKey: '747447',
        kind: 'root',
        id: 'R-broccoli',
        seedOwned: true,
        ...overrides,
    });

    it('answers a key no item owns and no root cites exactly with the entry holding its lineage, and counts it', async () => {
        const { reader, ownersOfLineage, sink } = makeReader({ lineage: [holder()], roots: [BROCCOLI] });

        const owners = await reader.ownersOfKeys('usda', [{ externalKey: '2709999', lineageKey: 'foundation:11090' }]);

        expect(owners.get('2709999')).toStrictEqual({
            kind: 'root',
            id: 'R-broccoli',
            rootId: 'R-broccoli',
            rootName: 'broccoli',
            seedOwned: true,
            parts: [],
        });
        expect(ownersOfLineage).toHaveBeenCalledWith('usda', ['foundation:11090']);
        expect(sink).toHaveBeenCalledTimes(1);
        expect(String(sink.mock.calls[0]?.[0])).toContain('"food-lineage-match"');
        expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toMatchObject({ source: 'usda' });
    });

    it('asks the lineage only for the keys an owner and an exact citation both left unresolved', async () => {
        const { reader, ownersOfLineage } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-brisket', seedOwned: true }],
            citing: new Map([['2', 'R-crust']]),
            lineage: [holder({ lineageKey: 'foundation:3' })],
            roots: [BRISKET, BROCCOLI, makeFoodRefFacts({ id: 'R-crust', name: 'pizza crust' })],
        });

        const owners = await reader.ownersOfKeys('usda', [
            { externalKey: '1', lineageKey: 'foundation:1' },
            { externalKey: '2', lineageKey: 'foundation:2' },
            { externalKey: '3', lineageKey: 'foundation:3' },
        ]);

        expect([...owners].map(([key, owner]) => [key, owner.id])).toEqual([
            ['1', 'R-brisket'],
            ['2', 'R-crust'],
            ['3', 'R-broccoli'],
        ]);
        expect(ownersOfLineage).toHaveBeenCalledExactlyOnceWith('usda', ['foundation:3']);
    });

    it('never asks the lineage for a key that carries none', async () => {
        const { reader, ownersOfLineage } = makeReader({ lineage: [holder()], roots: [BROCCOLI] });

        expect(await reader.ownersOfKeys('usda', keys('2709999'))).toStrictEqual(new Map());
        expect(ownersOfLineage).not.toHaveBeenCalled();
    });

    it('answers the one live entry when an earlier version’s retired holder forwards to it', async () => {
        const { reader } = makeReader({
            lineage: [holder({ id: 'R-old', externalKey: '169967' }), holder()],
            forwards: new Map([['R-old', { resolved: true, id: 'R-broccoli', kind: 'root', hops: 1 }]]),
            roots: [makeFoodRefFacts({ id: 'R-old', name: 'broccoli, old', retired: true }), BROCCOLI],
        });

        const owners = await reader.ownersOfKeys('usda', [{ externalKey: '2709999', lineageKey: 'foundation:11090' }]);

        expect(owners.get('2709999')?.id).toBe('R-broccoli');
    });

    // A holder with no live end (retired with no forward, or a broken chain) is no owner, as a dead owner of a key is
    // none; only the holders that reach a live entry must agree.
    it('answers the live holder when another holder is retired with no forward', async () => {
        const { reader } = makeReader({
            lineage: [holder({ id: 'R-gone', externalKey: '169967' }), holder()],
            roots: [makeFoodRefFacts({ id: 'R-gone', retired: true }), BROCCOLI],
        });

        const owners = await reader.ownersOfKeys('usda', [{ externalKey: '2709999', lineageKey: 'foundation:11090' }]);

        expect(owners.get('2709999')?.id).toBe('R-broccoli');
    });

    it('answers nothing when the lineage leads to two live entries, rather than choosing one', async () => {
        const { reader, sink } = makeReader({
            lineage: [holder(), holder({ id: 'R-other', externalKey: '747448' })],
            roots: [BROCCOLI, makeFoodRefFacts({ id: 'R-other', name: 'broccoli florets' })],
        });

        expect(
            await reader.ownersOfKeys('usda', [{ externalKey: '2709999', lineageKey: 'foundation:11090' }]),
        ).toStrictEqual(new Map());
        expect(sink).not.toHaveBeenCalled();
    });

    it('answers nothing for an authored holder: the reader is catalog-only', async () => {
        const { reader } = makeReader({
            lineage: [holder({ id: 'R-mine', seedOwned: false })],
            roots: [makeFoodRefFacts({ id: 'R-mine', userId: 'U-1', visibility: 'private' })],
        });

        expect(
            await reader.ownersOfKeys('usda', [{ externalKey: '2709999', lineageKey: 'foundation:11090' }]),
        ).toStrictEqual(new Map());
    });
});

describe('CatalogOwnerReader.refFacts — what the resolver decides over (curated U8 S5)', () => {
    it('reads roots and variants by kind, follows only the RETIRED ones, then reads the ends and the variants’ roots', async () => {
        const { reader, follow } = makeReader({
            forwards: new Map([['R-old', { resolved: true, id: 'V-flat', kind: 'variant', hops: 1 }]]),
            variants: [FLAT],
            roots: [makeFoodRefFacts({ id: 'R-old', retired: true }), BRISKET],
        });

        const facts = await reader.refFacts([
            { kind: 'root', id: 'R-old' },
            { kind: 'variant', id: 'V-flat' },
        ]);

        expect(follow).toHaveBeenCalledWith(['R-old']);
        expect([...facts.roots.keys()].sort()).toStrictEqual(['R-brisket', 'R-old']);
        expect([...facts.variants.keys()]).toStrictEqual(['V-flat']);
        expect(facts.forwards.get('R-old')).toStrictEqual({ resolved: true, id: 'V-flat', kind: 'variant', hops: 1 });
    });

    it('records an unresolved chain, so the resolver’s absent answer is still visible to an operator', async () => {
        const { reader, sink } = makeReader({
            forwards: new Map([['R-loop', { resolved: false, reason: 'cycle' }]]),
            roots: [makeFoodRefFacts({ id: 'R-loop', retired: true })],
        });

        await reader.refFacts([{ kind: 'root', id: 'R-loop' }]);

        expect(String(sink.mock.calls[0]?.[0])).toContain('food-forward-unresolved');
    });

    it('reads nothing for no refs, and follows nothing when no ref is retired', async () => {
        const { reader, follow, readRefFacts } = makeReader({ roots: [BRISKET] });

        await reader.refFacts([]);
        expect(readRefFacts).not.toHaveBeenCalled();

        await reader.refFacts([{ kind: 'root', id: 'R-brisket' }]);
        expect(follow).not.toHaveBeenCalled();
    });
});
