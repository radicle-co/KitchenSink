/**
 * The progressive food search (ADR-0055 points 4, 5 and 9; review rulings 1 and 4; finding 7): our database's frame
 * first, then one frame per remote source in the order they settle, then completion. Each database group fails alone;
 * a remote hit for a food the catalog holds or retired is hidden, a held one absent from the catalog results is
 * recorded as a gap after its frame is written, and a shown hit carries the name its root will carry and a sealed
 * reference, never the source's key or a variant. Each source's frame closes by the deadline, while the call behind it
 * keeps running.
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { RemoteSearchItem } from '@kitchensink/schema-remote-search';

import type { RemoteSearchRequest, RemoteSourceOutcome } from '../../../sources/remote/remoteSearchPort.js';
import type { CatalogOwner, KeyStanding, SourceKeyRef } from '../../catalogOwnerReader.service.js';
import type { SearchGap } from '../../domain/remoteHitTriage.js';
import type { AuthoredFoodSearchResponse, CatalogSearchResponse } from '../../foods.schema.js';
import {
    progressiveSearchFrameSchema,
    remoteFoodViewSchema,
    type ProgressiveSearchFrame,
} from '../../progressiveSearch.schema.js';
import { RemoteReferenceSealer } from '../../remote/RemoteReferenceSealer.js';
import { ProgressiveFoodSearch, REMOTE_FRAME_ITEM_LIMIT } from '../ProgressiveFoodSearch.js';

const SEALER = new RemoteReferenceSealer(new Uint8Array(randomBytes(32)));
const OWNER: CatalogOwner = {
    kind: 'root',
    id: 'R-kale',
    rootId: 'R-kale',
    rootName: 'kale',
    seedOwned: true,
    parts: [],
};
const HELD: RemoteSearchItem = { externalKey: '1', name: 'Kale, raw', lineageKey: 'foundation:11233' };
const RETIRED: RemoteSearchItem = { externalKey: '2', name: 'Kale, frozen', lineageKey: null };
const NEW: RemoteSearchItem = { externalKey: '3', name: '  Kale chips,​ baked ', lineageKey: 'foundation:99' };
const CATALOG: CatalogSearchResponse = { results: [{ id: 'R-other', name: 'curly kale', score: 0.9 }] };
const AUTHORED: AuthoredFoodSearchResponse = { results: [{ id: 'A-mine', name: 'my kale salad', score: 0.8 }] };

/** An answered source frame as written, every field of each item kept. */
const writtenSourceFrameSchema = z.object({
    type: z.literal('source'),
    source: z.string(),
    outcome: z.literal('answered'),
    items: z.array(z.record(z.string(), z.unknown())),
});

/** A deferred value a case settles by hand. */
interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
}

/**
 * A deferred value.
 *
 * @returns It and its resolver.
 */
function deferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });

    return { promise, resolve };
}

/** What a case's fakes do. */
interface World {
    readonly catalog?: () => Promise<CatalogSearchResponse>;
    readonly authored?: () => Promise<AuthoredFoodSearchResponse>;
    readonly remote?: (request: RemoteSearchRequest) => Promise<RemoteSourceOutcome>;
    readonly standing?: (keys: readonly SourceKeyRef[]) => Promise<KeyStanding>;
    readonly gaps?: () => Promise<void>;
    readonly deadlineMs?: number;
    readonly databaseDeadlineMs?: number;
}

/** What a case saw, in order. */
interface Seen {
    readonly events: string[];
    readonly frames: ProgressiveSearchFrame[];
    readonly lines: string[];
    readonly gaps: { source: string; gaps: readonly SearchGap[] }[];
    readonly remoteRequests: RemoteSearchRequest[];
    readonly standingKeys: SourceKeyRef[][];
    /** How many frames had been written each time the catalog was asked about a source's hits. */
    readonly framesAtTriage: number[];
    readonly authoredReads: number[];
    /** Each fault the search logged, by its message. */
    readonly logged: string[];
}

/**
 * The search over a world of fakes.
 *
 * @param world - What the fakes do.
 * @returns The search, and what it touched.
 */
function makeSearch(world: World = {}): { readonly search: ProgressiveFoodSearch; readonly seen: Seen } {
    const seen: Seen = {
        events: [],
        frames: [],
        lines: [],
        gaps: [],
        remoteRequests: [],
        standingKeys: [],
        framesAtTriage: [],
        authoredReads: [],
        logged: [],
    };

    return {
        seen,
        search: new ProgressiveFoodSearch({
            database: {
                searchCatalog: async () => (world.catalog ?? (async () => CATALOG))(),
                searchAuthored: async () => {
                    seen.authoredReads.push(1);

                    return (world.authored ?? (async () => AUTHORED))();
                },
            },
            remote: {
                search: async (request) => {
                    seen.remoteRequests.push(request);

                    return (world.remote ?? (async () => ({ kind: 'answered', items: [HELD, RETIRED, NEW] })))(request);
                },
            },
            owners: {
                standingOfKeys: async (_source, keys) => {
                    seen.standingKeys.push([...keys]);
                    seen.framesAtTriage.push(seen.frames.length);

                    return (
                        world.standing ?? (async () => ({ owners: new Map([['1', OWNER]]), retired: new Set(['2']) }))
                    )(keys);
                },
            },
            namedRoots: { liveCatalogRootsNamed: async () => new Map() },
            sealer: SEALER,
            gaps: {
                record: async (source, gaps) => {
                    seen.events.push(`gaps:${source}`);
                    seen.gaps.push({ source, gaps });

                    return (world.gaps ?? (async () => undefined))();
                },
            },
            frameDeadlineMs: world.deadlineMs ?? 1_000,
            databaseDeadlineMs: world.databaseDeadlineMs ?? 500,
            logger: {
                warn: (message) => {
                    seen.logged.push(message);
                },
                error: (message) => {
                    seen.logged.push(message);
                },
            },
        }),
    };
}

/**
 * Run a search for a cook and collect its frames.
 *
 * @param search - The search.
 * @param seen - Where frames go.
 * @param options - The term, the author, the caller's signal.
 * @returns When the search ends.
 */
async function run(
    search: ProgressiveFoodSearch,
    seen: Seen,
    options: { term?: string; authorId?: string | undefined; signal?: AbortSignal } = {},
): Promise<void> {
    await search.run(
        {
            term: options.term ?? 'kale',
            requesterId: '01JCOOK0000000000000000000',
            authorId: 'authorId' in options ? options.authorId : '01JCOOK0000000000000000000',
            signal: options.signal ?? new AbortController().signal,
        },
        {
            write: (frame) => {
                seen.events.push(frame.type === 'source' ? `source:${frame.source}` : frame.type);
                seen.frames.push(progressiveSearchFrameSchema.parse(frame));
                seen.lines.push(JSON.stringify(frame));
            },
        },
    );
}

describe('ProgressiveFoodSearch — the order of the frames', () => {
    it('writes the database frame first even when the source answers before it, then the source, then completion', async () => {
        const database = deferred<CatalogSearchResponse>();
        const { search, seen } = makeSearch({ catalog: async () => database.promise });
        const running = run(search, seen);

        await expect.poll(() => seen.remoteRequests.length).toBe(1);
        database.resolve(CATALOG);
        await running;

        // The source's hits are triaged against the database frame, so the source waits for it to be written.
        expect(seen.framesAtTriage).toStrictEqual([1]);

        expect(seen.events.filter((event) => !event.startsWith('gaps'))).toStrictEqual([
            'database',
            'source:usda',
            'complete',
        ]);
    });

    it('asks every remote source at once, with the cook as the requester and the canonical term', async () => {
        const { search, seen } = makeSearch();

        await run(search, seen);

        expect(seen.remoteRequests.map((request) => [request.source, request.term, request.requesterId])).toStrictEqual(
            [['usda', 'kale', '01JCOOK0000000000000000000']],
        );
    });
});

describe('ProgressiveFoodSearch — the database frame', () => {
    it('holds the catalog and the cook’s own authored foods, as their routes answer them', async () => {
        const { search, seen } = makeSearch();

        await run(search, seen);

        expect(seen.frames[0]).toStrictEqual({
            type: 'database',
            catalog: { outcome: 'answered', results: CATALOG.results },
            authored: { outcome: 'answered', results: AUTHORED.results },
        });
    });

    it.each<[string, World, ProgressiveSearchFrame]>([
        [
            'the catalog read',
            { catalog: async () => Promise.reject(new Error('down')) },
            {
                type: 'database',
                catalog: { outcome: 'unavailable' },
                authored: { outcome: 'answered', results: AUTHORED.results },
            },
        ],
        [
            'the authored read',
            { authored: async () => Promise.reject(new Error('down')) },
            {
                type: 'database',
                catalog: { outcome: 'answered', results: CATALOG.results },
                authored: { outcome: 'unavailable' },
            },
        ],
    ])('fails %s alone, and still asks every source', async (_label, world, frame) => {
        const { search, seen } = makeSearch(world);

        await run(search, seen);

        expect(seen.frames[0]).toStrictEqual(frame);
        expect(seen.frames.at(-1)).toStrictEqual({ type: 'complete' });
    });

    it('answers a service principal’s authored group empty, reading nothing: it authored nothing', async () => {
        const { search, seen } = makeSearch();

        await run(search, seen, { authorId: undefined });

        expect(seen.frames[0]).toMatchObject({ authored: { outcome: 'answered', results: [] } });
        expect(seen.authoredReads).toStrictEqual([]);
    });
});

describe('ProgressiveFoodSearch — a remote source’s frame', () => {
    it('⛔ shows only the hit the catalog does not hold, under its root’s name, with a reference that opens to it', async () => {
        const { search, seen } = makeSearch();

        await run(search, seen);

        const frame = seen.frames.find((candidate) => candidate.type === 'source');

        expect(frame).toMatchObject({ type: 'source', source: 'usda', outcome: 'answered' });

        if (frame?.type !== 'source' || frame.outcome !== 'answered') {
            throw new Error('expected an answered source frame');
        }

        expect(frame.items.map((item) => item.name)).toStrictEqual(['Kale chips, baked']);
        await expect(SEALER.open(frame.items[0]?.reference ?? '')).resolves.toStrictEqual({
            source: 'usda',
            externalKey: '3',
            lineageKey: 'foundation:99',
            name: 'Kale chips, baked',
        });
    });

    it('never puts the source’s key, or a variant, on the wire: a shown item carries only the published fields', async () => {
        const { search, seen } = makeSearch({
            remote: async () => ({
                kind: 'answered',
                items: [{ externalKey: '987654321', name: 'Kale', lineageKey: null }],
            }),
            standing: async () => ({ owners: new Map(), retired: new Set() }),
        });

        await run(search, seen);

        // The line as written, before any schema strips a field it does not know.
        const written = writtenSourceFrameSchema.parse(JSON.parse(seen.lines[1] ?? 'null'));

        expect(written).toMatchObject({
            type: 'source',
            source: 'usda',
            outcome: 'answered',
            items: [{ name: 'Kale' }],
        });
        expect(Object.keys(written.items[0] ?? {}).sort()).toStrictEqual(
            Object.keys(remoteFoodViewSchema.shape).sort(),
        );
        expect(seen.lines[1]).not.toContain('987654321');
    });

    it('asks the catalog about each hit with its lineage, at most the frame’s limit of them', async () => {
        const many = Array.from({ length: REMOTE_FRAME_ITEM_LIMIT + 5 }, (_, index) => ({
            externalKey: String(index + 100),
            name: `Kale ${String(index)}`,
            lineageKey: null,
        }));
        const { search, seen } = makeSearch({ remote: async () => ({ kind: 'answered', items: many }) });

        await run(search, seen);

        expect(seen.standingKeys[0]).toHaveLength(REMOTE_FRAME_ITEM_LIMIT);
        expect(seen.standingKeys[0]?.[0]).toStrictEqual({ externalKey: '100', lineageKey: null });
    });

    it('hides a hit whose name has nothing visible, which no root can carry', async () => {
        const { search, seen } = makeSearch({
            remote: async () => ({ kind: 'answered', items: [{ externalKey: '9', name: '​', lineageKey: null }] }),
            standing: async () => ({ owners: new Map(), retired: new Set() }),
        });

        await run(search, seen);

        expect(seen.frames[1]).toStrictEqual({ type: 'source', source: 'usda', outcome: 'answered', items: [] });
    });

    it('drops a lineage key in a form the catalog cannot hold, rather than sealing it', async () => {
        const { search, seen } = makeSearch({
            remote: async () => ({
                kind: 'answered',
                items: [{ externalKey: '9', name: 'Kale', lineageKey: 'ndb:1' }],
            }),
            standing: async () => ({ owners: new Map(), retired: new Set() }),
        });

        await run(search, seen);

        expect(seen.standingKeys[0]).toStrictEqual([{ externalKey: '9', lineageKey: null }]);
    });

    it.each<[RemoteSourceOutcome, ProgressiveSearchFrame]>([
        [
            { kind: 'busy', retryAfterSeconds: 60 },
            { type: 'source', source: 'usda', outcome: 'busy', retryAfterSeconds: 60 },
        ],
        [
            { kind: 'limited', retryAfterSeconds: 1_200 },
            { type: 'source', source: 'usda', outcome: 'limited', retryAfterSeconds: 1_200 },
        ],
        [{ kind: 'unavailable' }, { type: 'source', source: 'usda', outcome: 'unavailable' }],
    ])('reports %j as the source’s own frame, and the database frame still stands', async (outcome, frame) => {
        const { search, seen } = makeSearch({ remote: async () => outcome });

        await run(search, seen);

        expect(seen.frames.map((candidate) => candidate.type)).toStrictEqual(['database', 'source', 'complete']);
        expect(seen.frames[1]).toStrictEqual(frame);
    });

    it('reports a source unavailable when the catalog cannot say which of its hits it holds', async () => {
        const { search, seen } = makeSearch({ standing: async () => Promise.reject(new Error('down')) });

        await run(search, seen);

        expect(seen.frames[1]).toStrictEqual({ type: 'source', source: 'usda', outcome: 'unavailable' });
        expect(seen.gaps).toStrictEqual([]);
    });

    it('asks no source for a term below the search minimum, and answers each with nothing', async () => {
        const { search, seen } = makeSearch();

        await run(search, seen, { term: 'k' });

        expect(seen.remoteRequests).toStrictEqual([]);
        expect(seen.frames[1]).toStrictEqual({ type: 'source', source: 'usda', outcome: 'answered', items: [] });
    });
});

describe('ProgressiveFoodSearch — search gaps', () => {
    it('records a held hit absent from the catalog results, after its source’s frame is written', async () => {
        const { search, seen } = makeSearch();

        await run(search, seen);

        expect(seen.gaps).toStrictEqual([
            {
                source: 'usda',
                gaps: [
                    {
                        query: 'kale',
                        source: 'usda',
                        externalKey: '1',
                        foodId: 'R-kale',
                        foodVariantId: null,
                        remoteName: 'Kale, raw',
                    },
                ],
            },
        ]);
        expect(seen.events.indexOf('gaps:usda')).toBeGreaterThan(seen.events.indexOf('source:usda'));
    });

    it('⛔ writes completion before any gap is recorded, so a slow gap write never holds the answer back', async () => {
        const gapWrite = deferred<undefined>();
        const { search, seen } = makeSearch({ gaps: async () => gapWrite.promise });
        let settled = false;
        const running = run(search, seen).then(() => {
            settled = true;
        });

        await expect.poll(() => seen.events.includes('gaps:usda')).toBe(true);

        expect(seen.events).toStrictEqual(['database', 'source:usda', 'complete', 'gaps:usda']);
        expect(settled).toBe(false);
        gapWrite.resolve(undefined);
        await running;
    });

    it('logs a gap write that fails, and the search still ends', async () => {
        const { search, seen } = makeSearch({ gaps: async () => Promise.reject(new Error('pool exhausted')) });

        await run(search, seen);

        expect(seen.events.at(-2)).toBe('complete');
        expect(seen.logged).toStrictEqual(['progressive-search-gap-record-failed']);
    });

    it('records nothing for a held hit whose root the catalog results show', async () => {
        const { search, seen } = makeSearch({
            catalog: async () => ({ results: [{ id: 'R-kale', name: 'kale', score: 1 }] }),
        });

        await run(search, seen);

        expect(seen.gaps).toStrictEqual([]);
    });

    it('records nothing when the catalog read failed', async () => {
        const { search, seen } = makeSearch({ catalog: async () => Promise.reject(new Error('down')) });

        await run(search, seen);

        expect(seen.gaps).toStrictEqual([]);
    });
});

describe('ProgressiveFoodSearch — the deadline and the caller', () => {
    it('⛔ closes a source that has not answered by the deadline as unavailable, and completes, without cancelling it', async () => {
        const never = deferred<RemoteSourceOutcome>();
        const { search, seen } = makeSearch({ remote: async () => never.promise, deadlineMs: 50 });

        await run(search, seen);

        expect(seen.frames.slice(1)).toStrictEqual([
            { type: 'source', source: 'usda', outcome: 'unavailable' },
            { type: 'complete' },
        ]);
        // The signal the source was asked with ended at the deadline, which only stops a wait for a cached answer.
        expect(seen.remoteRequests[0]?.signal.aborted).toBe(true);
        never.resolve({ kind: 'answered', items: [NEW] });
    });

    it('⛔ answers a database group that has not been read by its deadline as unavailable, and still answers the rest', async () => {
        const hung = deferred<CatalogSearchResponse>();
        const { search, seen } = makeSearch({ catalog: async () => hung.promise, databaseDeadlineMs: 30 });

        await run(search, seen);

        expect(seen.frames[0]).toStrictEqual({
            type: 'database',
            catalog: { outcome: 'unavailable' },
            authored: { outcome: 'answered', results: AUTHORED.results },
        });
        expect(seen.frames.map((frame) => frame.type)).toStrictEqual(['database', 'source', 'complete']);
        expect(seen.logged).toStrictEqual(['progressive-search-database-deadline']);
        hung.resolve(CATALOG);
    });

    it('⛔ closes a source whose hits the catalog has not triaged by the deadline as unavailable, and completes', async () => {
        const hung = deferred<KeyStanding>();
        const { search, seen } = makeSearch({ standing: async () => hung.promise, deadlineMs: 50 });

        await run(search, seen);

        expect(seen.frames.slice(1)).toStrictEqual([
            { type: 'source', source: 'usda', outcome: 'unavailable' },
            { type: 'complete' },
        ]);
        expect(seen.gaps).toStrictEqual([]);
        expect(seen.logged).toStrictEqual(['progressive-search-triage-deadline']);
        hung.resolve({ owners: new Map(), retired: new Set() });
    });

    it('writes nothing more once the caller has gone, not even completion', async () => {
        const caller = new AbortController();
        const slow = deferred<RemoteSourceOutcome>();
        const { search, seen } = makeSearch({ remote: async () => slow.promise });
        const running = run(search, seen, { signal: caller.signal });

        await expect.poll(() => seen.frames.length).toBe(1);
        caller.abort();
        slow.resolve({ kind: 'answered', items: [NEW] });
        await running;

        expect(seen.frames.map((frame) => frame.type)).toStrictEqual(['database']);
    });
});
