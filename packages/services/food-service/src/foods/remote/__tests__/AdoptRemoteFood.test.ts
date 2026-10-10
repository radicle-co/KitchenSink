/**
 * The remote pick command (ADR-0055 points 4 and 10; review ruling 9). It opens the reference food issued, answers
 * from the catalog when the catalog already stands for the item, refuses an item the catalog retired with no forward,
 * and otherwise fetches the item once and makes it a new root under the name the cook picked. It is idempotent on the
 * source and the key: any later pick of the item answers the same root.
 *
 * The reader, the source, the sealer and the adoption write are fakes; the write's SQL is
 * `tests/e2e/remoteAdoption.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { CanonicalCandidate } from '../../../sources/foodSourceAdapter.js';
import {
    AdapterValidationError,
    SourceAccountingError,
    SourceApiError,
    SourceBusyError,
} from '../../../sources/foodSource.errors.js';
import type { CatalogOwner, KeyStanding, SourceKeyRef } from '../../catalogOwnerReader.service.js';
import type { FoodLease } from '../../dao/fetchQueue.dao.js';
import { LeaseLostError, leaseFenceFrom, type LeaseFence } from '../../dao/leaseFence.js';
import type { AdoptionWrite, AdoptionWriteInput, NamedRoot } from '../../dao/remoteAdoption.dao.js';
import { FetchUnavailableError, isFetchUnavailableError, isRemoteFoodGoneError } from '../../foods.errors.js';
import { makeMergeCandidate } from '../../merge/__fixtures__/merge.fixtures.js';
import { AdoptRemoteFood } from '../AdoptRemoteFood.js';
import { InvalidRemoteReferenceError } from '../remoteReference.errors.js';
import type { RemoteFoodReference } from '../RemoteReferenceSealer.js';

/** 2026-10-02 05:00:00 UTC. */
const NOW = Date.UTC(2026, 9, 2, 5, 0, 0);
const TOKEN = 'sealed.reference.token.for.kale';
const REFERENCE: RemoteFoodReference = {
    source: 'usda',
    externalKey: '900001',
    lineageKey: 'foundation:11233',
    name: 'Kale chips, baked',
};
const OWNER: CatalogOwner = {
    kind: 'variant',
    id: 'V-kale-chips',
    rootId: 'R-kale',
    rootName: 'kale',
    seedOwned: true,
    parts: [],
};
const FETCHED: CanonicalCandidate = makeMergeCandidate('usda', {
    externalKey: '900001',
    name: 'KALE CHIPS, BAKED (renamed upstream)',
});
const NOT_HELD: KeyStanding = { owners: new Map(), retired: new Set() };
const FENCE: LeaseFence = leaseFenceFrom('2026-10-02 05:00:00.123456+00');
const PLACEHOLDER: NamedRoot = { id: 'R-placeholder', status: 'PENDING' };

/** What a case's fakes do. */
interface World {
    readonly opened?: RemoteFoodReference | Error;
    readonly standings?: readonly KeyStanding[];
    readonly named?: NamedRoot;
    readonly lease?: FoodLease;
    readonly fetched?: CanonicalCandidate | Error;
    readonly write?: AdoptionWrite | Error;
}

/** What a case's fakes saw. */
interface Seen {
    readonly standingKeys: SourceKeyRef[][];
    readonly fetches: string[];
    readonly names: string[];
    readonly writes: AdoptionWriteInput[];
    readonly persisted: CanonicalCandidate[];
    readonly leased: string[];
    readonly released: { foodId: string; seconds: number; fence: string }[];
    readonly warnings: string[];
}

/**
 * The command over a world of fakes.
 *
 * @param world - What the fakes do.
 * @returns The command and what it touched.
 */
function makeCommand(world: World): { readonly command: AdoptRemoteFood; readonly seen: Seen } {
    const seen: Seen = {
        standingKeys: [],
        fetches: [],
        names: [],
        writes: [],
        persisted: [],
        leased: [],
        released: [],
        warnings: [],
    };
    const standings = [...(world.standings ?? [NOT_HELD])];

    return {
        seen,
        command: new AdoptRemoteFood({
            sealer: {
                open: async () => {
                    const opened = world.opened ?? REFERENCE;

                    if (opened instanceof Error) {
                        throw opened;
                    }

                    return opened;
                },
            },
            owners: {
                standingOfKeys: async (_source, keys) => {
                    seen.standingKeys.push([...keys]);

                    return standings.shift() ?? NOT_HELD;
                },
            },
            registry: {
                adapterFor: () => ({
                    source: 'usda',
                    searchByName: async () => [],
                    fetchByKey: async (externalKey) => {
                        seen.fetches.push(externalKey);

                        const fetched = world.fetched ?? FETCHED;

                        if (fetched instanceof Error) {
                            throw fetched;
                        }

                        return fetched;
                    },
                }),
            },
            adoption: {
                liveCatalogRootNamed: async (normalizedName) => {
                    seen.names.push(normalizedName);

                    return world.named;
                },
                adopt: async (input) => {
                    seen.writes.push(input);

                    if (world.write instanceof Error) {
                        throw world.write;
                    }

                    return world.write ?? { kind: 'created', id: 'R-new' };
                },
            },
            queue: {
                leaseFood: async (foodId) => {
                    seen.leased.push(foodId);

                    return world.lease ?? { kind: 'leased', fence: FENCE };
                },
                deferLease: async (foodId, seconds, authority) => {
                    seen.released.push({ foodId, seconds, fence: authority });
                },
            },
            persistRoot: (candidate) => {
                seen.persisted.push(candidate);

                return async () => undefined;
            },
            now: () => NOW,
            logger: { warn: (message) => seen.warnings.push(message) },
        }),
    };
}

describe('AdoptRemoteFood — what the catalog already says', () => {
    it('answers the root that stands for a held item, with no fetch and no write, asking with the item’s lineage', async () => {
        const { command, seen } = makeCommand({
            standings: [{ owners: new Map([['900001', OWNER]]), retired: new Set() }],
        });

        await expect(command.execute(TOKEN)).resolves.toStrictEqual({ id: 'R-kale' });
        expect(seen.standingKeys).toStrictEqual([[{ externalKey: '900001', lineageKey: 'foundation:11233' }]]);
        expect(seen.fetches).toStrictEqual([]);
        expect(seen.writes).toStrictEqual([]);
    });

    it('refuses an item the catalog retired with no forward, as gone, with no fetch', async () => {
        const { command, seen } = makeCommand({ standings: [{ owners: new Map(), retired: new Set(['900001']) }] });

        await expect(command.execute(TOKEN)).rejects.toSatisfy(isRemoteFoodGoneError);
        expect(seen.fetches).toStrictEqual([]);
    });

    it('answers the live catalog root that carries the name with a record, with no lease and no fetch', async () => {
        const { command, seen } = makeCommand({ named: { id: 'R-chips', status: 'RESOLVED' } });

        await expect(command.execute(TOKEN)).resolves.toStrictEqual({ id: 'R-chips' });
        expect(seen.names).toStrictEqual(['kale chips, baked']);
        expect(seen.leased).toStrictEqual([]);
        expect(seen.fetches).toStrictEqual([]);
    });

    it.each(['unreadable', 'version', 'shape'] as const)(
        'refuses a reference it cannot open (%s) as gone, logged, asking nothing',
        async (reason) => {
            const { command, seen } = makeCommand({ opened: new InvalidRemoteReferenceError(reason) });

            await expect(command.execute(TOKEN)).rejects.toSatisfy(isRemoteFoodGoneError);
            expect(seen.standingKeys).toStrictEqual([]);
            expect(seen.warnings).toStrictEqual(['remote-adopt-reference-refused']);
        },
    );
});

describe('AdoptRemoteFood — a new root', () => {
    it('fetches the item once and adopts it under the name the cook picked, never the source’s new name', async () => {
        const { command, seen } = makeCommand({});

        await expect(command.execute(TOKEN)).resolves.toStrictEqual({ id: 'R-new' });
        expect(seen.fetches).toStrictEqual(['900001']);
        expect(seen.writes).toHaveLength(1);
        expect(seen.writes[0]).toMatchObject({
            source: 'usda',
            externalKey: '900001',
            name: 'Kale chips, baked',
            normalizedName: 'kale chips, baked',
        });
        expect(seen.persisted).toStrictEqual([{ ...FETCHED, name: 'Kale chips, baked' }]);
    });

    it('answers the root a concurrent writer made when the write finds the item crosswalked', async () => {
        const { command, seen } = makeCommand({
            standings: [NOT_HELD, { owners: new Map([['900001', OWNER]]), retired: new Set() }],
            write: { kind: 'crosswalked' },
        });

        await expect(command.execute(TOKEN)).resolves.toStrictEqual({ id: 'R-kale' });
        expect(seen.standingKeys).toHaveLength(2);
    });

    it('answers the root that took the name while the item was fetched', async () => {
        const { command } = makeCommand({ write: { kind: 'named', id: 'R-chips' } });

        await expect(command.execute(TOKEN)).resolves.toStrictEqual({ id: 'R-chips' });
    });

    it('refuses as gone an item a concurrent writer crosswalked and the catalog then retired', async () => {
        const { command } = makeCommand({
            standings: [NOT_HELD, { owners: new Map(), retired: new Set(['900001']) }],
            write: { kind: 'crosswalked' },
        });

        await expect(command.execute(TOKEN)).rejects.toSatisfy(isRemoteFoodGoneError);
    });

    it('refuses a name with nothing visible, which no root can carry, with no fetch', async () => {
        const { command, seen } = makeCommand({ opened: { ...REFERENCE, name: '​' } });

        await expect(command.execute(TOKEN)).rejects.toSatisfy(isRemoteFoodGoneError);
        expect(seen.fetches).toStrictEqual([]);
    });

    it('refuses a fetched item that is not the one the reference names, writing nothing', async () => {
        const { command, seen } = makeCommand({ fetched: { ...FETCHED, externalKey: '900002' } });

        await expect(command.execute(TOKEN)).rejects.toThrow(/not the item/u);
        expect(seen.writes).toStrictEqual([]);
    });
});

/**
 * A live catalog root with no record carrying the picked name (the lead's ruling on S7.6): the pick completes it, so a
 * line bound to it gains the data. The pick leases the root's queue row before fetching, so no drain fetches for it
 * meanwhile, and answers busy, fetching nothing, while a drain does.
 */
describe('AdoptRemoteFood — a placeholder root that carries the name', () => {
    it('⛔ leases its queue row, fetches once, and completes it under that lease, answering its id', async () => {
        const { command, seen } = makeCommand({
            named: PLACEHOLDER,
            write: { kind: 'completed', id: 'R-placeholder' },
        });

        await expect(command.execute(TOKEN)).resolves.toStrictEqual({ id: 'R-placeholder' });
        expect(seen.leased).toStrictEqual(['R-placeholder']);
        expect(seen.fetches).toStrictEqual(['900001']);
        expect(seen.writes[0]?.lease).toStrictEqual({ rootId: 'R-placeholder', fence: FENCE });
        expect(seen.released).toStrictEqual([]);
    });

    it.each(['AWAITING_RETRY', 'UNRESOLVED', 'NOT_FOUND', 'FAILED'] as const)(
        'completes a %s root the same way',
        async (status) => {
            const { command, seen } = makeCommand({
                named: { ...PLACEHOLDER, status },
                write: { kind: 'completed', id: 'R-placeholder' },
            });

            await expect(command.execute(TOKEN)).resolves.toStrictEqual({ id: 'R-placeholder' });
            expect(seen.fetches).toHaveLength(1);
        },
    );

    it('⛔ answers busy and fetches nothing while a drain is fetching for the root', async () => {
        const { command, seen } = makeCommand({ named: PLACEHOLDER, lease: { kind: 'draining' } });

        await expect(command.execute(TOKEN)).rejects.toSatisfy(isFetchUnavailableError);
        expect(seen.fetches).toStrictEqual([]);
        expect(seen.writes).toStrictEqual([]);
    });

    it('completes a root no drain will take with no lease to present', async () => {
        const { command, seen } = makeCommand({
            named: PLACEHOLDER,
            lease: { kind: 'idle' },
            write: { kind: 'completed', id: 'R-placeholder' },
        });

        await expect(command.execute(TOKEN)).resolves.toStrictEqual({ id: 'R-placeholder' });
        expect(seen.writes[0]?.lease).toBeUndefined();
    });

    it('gives the lease back, due at once, when the fetch fails', async () => {
        const { command, seen } = makeCommand({
            named: PLACEHOLDER,
            fetched: new SourceApiError('usda', 503, 'unavailable'),
        });

        await expect(command.execute(TOKEN)).rejects.toBeInstanceOf(FetchUnavailableError);
        expect(seen.released).toStrictEqual([{ foodId: 'R-placeholder', seconds: 0, fence: FENCE }]);
    });

    it.each<[string, AdoptionWrite, { id: string } | 'busy']>([
        ['the root gained a record meanwhile', { kind: 'named', id: 'R-placeholder' }, { id: 'R-placeholder' }],
        ['a drain took the root meanwhile', { kind: 'draining' }, 'busy'],
        ['another root took the name meanwhile', { kind: 'completed', id: 'R-other' }, { id: 'R-other' }],
    ])('gives the lease back when %s', async (_label, write, answer) => {
        const { command, seen } = makeCommand({ named: PLACEHOLDER, write });
        const outcome = command.execute(TOKEN);

        if (answer === 'busy') {
            await expect(outcome).rejects.toSatisfy(isFetchUnavailableError);
        } else {
            await expect(outcome).resolves.toStrictEqual(answer);
        }

        expect(seen.released).toStrictEqual([{ foodId: 'R-placeholder', seconds: 0, fence: FENCE }]);
    });

    it('answers busy when the lease was lost before the write settled, and gives nothing back', async () => {
        const { command, seen } = makeCommand({
            named: PLACEHOLDER,
            write: new LeaseLostError('R-placeholder', 'resolve'),
        });

        await expect(command.execute(TOKEN)).rejects.toSatisfy(isFetchUnavailableError);
        expect(seen.released).toStrictEqual([]);
    });
});

describe('AdoptRemoteFood — when the source cannot answer', () => {
    it('answers a busy source as busy for as long as its refusal says, never retried', async () => {
        const { command, seen } = makeCommand({
            fetched: new SourceBusyError('usda', 'ceiling', new Date(NOW + 41_500).toISOString()),
        });

        await expect(command.execute(TOKEN)).rejects.toSatisfy(
            (error: unknown) => isFetchUnavailableError(error) && error.retryAfterSeconds === 42,
        );
        expect(seen.fetches).toHaveLength(1);
    });

    it.each<[string, Error]>([
        ['our own accounting failing', new SourceAccountingError('usda', 'admit', new Error('down'))],
        ['a source 503', new SourceApiError('usda', 503, 'unavailable')],
        ['a source timeout', new SourceApiError('usda', 0, 'timeout')],
    ])('answers %s as busy for a short wait', async (_label, failure) => {
        const { command } = makeCommand({ fetched: failure });

        await expect(command.execute(TOKEN)).rejects.toBeInstanceOf(FetchUnavailableError);
    });

    it.each<[string, Error]>([
        ['a source 404: the item is gone upstream', new SourceApiError('usda', 404, 'not found')],
        ['an item whose data cannot be stored', new AdapterValidationError('usda', '900001', 'name', 'blank')],
    ])('refuses %s as gone', async (_label, failure) => {
        const { command } = makeCommand({ fetched: failure });

        await expect(command.execute(TOKEN)).rejects.toSatisfy(isRemoteFoodGoneError);
    });
});
