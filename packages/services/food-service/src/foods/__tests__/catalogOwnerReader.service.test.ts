/**
 * The catalog owner reader (curated plan U8 S4, R19): a source item key → the live catalog root or variant that owns
 * it, else the seed root that cites it, following forwards to a live ref.
 *
 * Unit tier over doubled DAOs. The SQL of each DAO is the LOCAL e2e tier's job
 * (`tests/e2e/catalogOwnerReader.e2e.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

import { makeFoodRefFacts } from '../__fixtures__/foodRefFacts.js';
import { CatalogOwnerReader } from '../catalogOwnerReader.service.js';
import type { FoodDao, FoodRefFacts } from '../dao/food.dao.js';
import type { FoodForwardDao, ForwardOutcome } from '../dao/foodForward.dao.js';
import type { FoodSourcesDao, ItemOwner } from '../dao/foodSources.dao.js';
import type { FoodVariantDao, VariantFacts } from '../dao/foodVariant.dao.js';
import { FoodMetrics } from '../../observability/emfMetrics.js';

interface World {
    readonly owners?: readonly ItemOwner[];
    readonly citing?: ReadonlyMap<string, string>;
    readonly forwards?: ReadonlyMap<string, ForwardOutcome>;
    readonly variants?: readonly VariantFacts[];
    readonly roots?: readonly FoodRefFacts[];
}

/** The reader over a world of doubled DAOs, and the spies a case asserts on. */
function makeReader(world: World): {
    reader: CatalogOwnerReader;
    citingSeedRoots: ReturnType<typeof vi.fn>;
    readRefFacts: ReturnType<typeof vi.fn>;
    readFacts: ReturnType<typeof vi.fn>;
    follow: ReturnType<typeof vi.fn>;
    sink: ReturnType<typeof vi.fn>;
} {
    const ownersOf = vi.fn(async () => [...(world.owners ?? [])]);
    const citingSeedRoots = vi.fn(async (_source: string, keys: readonly string[]) => {
        return new Map([...(world.citing ?? new Map<string, string>())].filter(([key]) => keys.includes(key)));
    });
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
        { ownersOf, citingSeedRoots } as unknown as FoodSourcesDao,
        { follow } as unknown as FoodForwardDao,
        { readFacts } as unknown as FoodVariantDao,
        { readRefFacts } as unknown as FoodDao,
        new FoodMetrics(sink),
    );

    return { reader, citingSeedRoots, readRefFacts, readFacts, follow, sink };
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

        expect(await reader.ownersOfKeys('usda', ['174531'])).toStrictEqual(
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

        expect((await reader.ownersOfKeys('usda', ['174532'])).get('174532')).toStrictEqual({
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

        expect((await reader.ownersOfKeys('usda', ['174531'])).get('174531')?.id).toBe('R-brisket');
        expect(citingSeedRoots).not.toHaveBeenCalled();
    });

    it('maps a key no item owns to the seed root that cites it', async () => {
        const { reader, citingSeedRoots } = makeReader({
            citing: new Map([['999', 'R-crust']]),
            roots: [makeFoodRefFacts({ id: 'R-crust', name: 'pizza crust' })],
        });

        expect((await reader.ownersOfKeys('usda', ['999'])).get('999')).toStrictEqual({
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

        expect((await reader.ownersOfKeys('usda', ['1'])).get('1')).toMatchObject({
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

        const owners = await reader.ownersOfKeys('usda', ['1', '2']);

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

        expect(await reader.ownersOfKeys('usda', ['1'])).toStrictEqual(new Map());
        expect(sink).toHaveBeenCalledTimes(1);
        expect(String(sink.mock.calls[0]?.[0])).toContain('food-forward-unresolved');
    });

    it('answers nothing for a retired root with no forward', async () => {
        const { reader } = makeReader({
            owners: [{ externalKey: '1', kind: 'root', id: 'R-gone', seedOwned: true }],
            roots: [makeFoodRefFacts({ id: 'R-gone', retired: true })],
        });

        expect(await reader.ownersOfKeys('usda', ['1'])).toStrictEqual(new Map());
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

        expect((await reader.ownersOfKeys('usda', ['1'])).get('1')).toStrictEqual({
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

        const owners = await reader.ownersOfKeys('usda', ['1', '2']);

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

        expect(await reader.ownersOfKeys('usda', ['1'])).toStrictEqual(new Map());
    });

    it('reads nothing for no keys', async () => {
        const { reader, citingSeedRoots } = makeReader({});

        expect(await reader.ownersOfKeys('usda', [])).toStrictEqual(new Map());
        expect(citingSeedRoots).not.toHaveBeenCalled();
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
