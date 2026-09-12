/**
 * Integration (mocked, CODING_STANDARDS §7.1a): the Matvaretabellen mirror sync as phase C will compose it — the real
 * `MirrorSync`, feeds, parser, mapper and drift check over the committed snapshot and extract — with the mirror table
 * as an in-memory double and the publisher as a stub `fetch` behind the real `RateLimitedTransport`.
 *
 * It pins what only the composition can show (plan U28, R60, KTD-26, ADR-0053 §7):
 *
 * - a preview fills its mirror from the committed snapshot, and a second sync writes nothing;
 * - an unchanged sync still checks drift against the committed extract, so a drift report repeats on every run;
 * - the committed snapshot and the publisher feed give one source version for one content, so a mirror a preview
 *   filled from the snapshot is current against the publisher, and a sandbox sync of the same table writes nothing;
 * - through the publisher feed, a busy source pauses with no write and no call, and a 503 writes its block and fails
 *   the run with nothing written.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import { parseSourceExtract, type ExtractLine } from '../src/foods/seed/archive/sourceExtract.js';
import { parseTableExtractPins } from '../src/foods/seed/archive/tableExtractPins.js';
import { isSourceApiError } from '../src/sources/foodSource.errors.js';
import { matvaretabellenFeed } from '../src/sources/matvaretabellen/matvaretabellenFeed.js';
import { parseMatvaretabellenFoods } from '../src/sources/matvaretabellen/matvaretabellenFoods.js';
import {
    MATVARETABELLEN_MIRROR_TAGS,
    matvaretabellenExtractLine,
} from '../src/sources/matvaretabellen/matvaretabellenMirrorMapper.js';
import { committedSnapshotFeed, type CommittedSnapshot } from '../src/sources/mirror/committedSnapshotFeed.js';
import { extractDrift } from '../src/sources/mirror/extractDrift.js';
import type { MirrorFeed, MirrorItem } from '../src/sources/mirror/mirrorFeed.js';
import { MirrorSync } from '../src/sources/mirror/MirrorSync.js';
import { InMemoryMirrorStore } from '../src/sources/mirror/__fixtures__/InMemoryMirrorStore.js';
import {
    RateLimitedTransport,
    type Admission,
    type SourceBlock,
} from '../src/sources/transport/RateLimitedTransport.js';

const DATA_DIR = join(import.meta.dirname, '../src/foods/seed/data/matvaretabellen');

let snapshot: CommittedSnapshot;
let extract: ReadonlyMap<string, ExtractLine>;
let publishedText: string;

beforeAll(async () => {
    const pins = parseTableExtractPins(await readFile(join(DATA_DIR, 'sourcePins.json'), 'utf8'));
    const foods = pins.snapshots?.['foods'];

    if (foods === undefined) {
        throw new Error('the Matvaretabellen pins name no foods snapshot');
    }

    snapshot = { path: join(DATA_DIR, foods.committed), upstreamSha256: foods.upstreamSha256 };
    extract = parseSourceExtract(await readFile(join(DATA_DIR, pins.extract)));
    publishedText = gunzipSync(await readFile(snapshot.path)).toString('utf8');
});

/** A sync of a feed into a store, drift-checked against an extract (by default the committed one), counting runs. */
function syncOf(feed: MirrorFeed, store: InMemoryMirrorStore, cited: ReadonlyMap<string, ExtractLine> = extract) {
    const completed: string[] = [];
    const sync = new MirrorSync({
        feed,
        store,
        drift: (items: readonly MirrorItem[]) =>
            extractDrift(items, cited, matvaretabellenExtractLine, MATVARETABELLEN_MIRROR_TAGS),
        metrics: { mirrorSyncCompleted: (source) => completed.push(source) },
    });

    return { sync, completed };
}

/** The publisher feed over the real transport, serving `respond`, and what the doubles saw. */
function publisherFeed(respond: () => Response, admission: Admission = { admitted: true }) {
    const admissions: string[] = [];
    const blocks: SourceBlock[] = [];
    let upstreamCalls = 0;
    const transport = new RateLimitedTransport({
        admission: {
            admit: async (source, lane) => {
                admissions.push(`${source}:${lane}`);

                return admission;
            },
        },
        blocks: { record: async (block) => void blocks.push(block) },
        metrics: { recordSourceRateLimit: () => undefined },
        upstream: async () => {
            upstreamCalls += 1;

            return respond();
        },
    });

    return {
        feed: matvaretabellenFeed(transport.fetchFor('matvaretabellen', 'worker')),
        admissions,
        blocks,
        upstreamCalls: () => upstreamCalls,
    };
}

describe('the Matvaretabellen mirror sync', () => {
    it('fills a mirror from the committed snapshot with no drift, and a second sync writes nothing', async () => {
        const store = new InMemoryMirrorStore();
        const { sync, completed } = syncOf(
            committedSnapshotFeed('matvaretabellen', snapshot, parseMatvaretabellenFoods),
            store,
        );

        const first = await sync.run();
        const writesAfterFirst = [...store.writes];
        const second = await sync.run();

        expect(
            first.outcome === 'synced' && { changed: first.changed, vanished: first.vanished, drift: first.drift },
        ).toEqual({
            changed: parseMatvaretabellenFoods(publishedText).items.length,
            vanished: [],
            drift: [],
        });
        expect(second.outcome).toBe('unchanged');
        expect(store.writes).toEqual(writesAfterFirst);
        expect(completed).toEqual(['matvaretabellen', 'matvaretabellen']);
    });

    it('reports drift again on an unchanged sync, so a missed report repeats', async () => {
        const [anyLine] = extract.values();

        if (anyLine === undefined) {
            throw new Error('the committed Matvaretabellen extract is empty');
        }

        // A key the seed cites that the publisher no longer lists: the drift every run must keep reporting.
        const cited = new Map([...extract, ['99.999', { ...anyLine, key: '99.999' }]]);
        const store = new InMemoryMirrorStore();
        const { sync } = syncOf(
            committedSnapshotFeed('matvaretabellen', snapshot, parseMatvaretabellenFoods),
            store,
            cited,
        );

        const first = await sync.run();
        const writesAfterFirst = [...store.writes];
        const second = await sync.run();

        expect(first.outcome === 'synced' && first.drift).toEqual([{ kind: 'absent', externalKey: '99.999' }]);
        expect(second.outcome === 'unchanged' && second.drift).toEqual([{ kind: 'absent', externalKey: '99.999' }]);
        expect(store.writes).toEqual(writesAfterFirst);
    });

    it('gives the snapshot and the publisher one version for one content, so the publisher sync writes nothing', async () => {
        const store = new InMemoryMirrorStore();
        const publisher = publisherFeed(() => new Response(publishedText));

        await syncOf(committedSnapshotFeed('matvaretabellen', snapshot, parseMatvaretabellenFoods), store).sync.run();
        const writesAfterSnapshot = [...store.writes];
        const result = await syncOf(publisher.feed, store).sync.run();

        expect(result.outcome).toBe('unchanged');
        expect(store.writes).toEqual(writesAfterSnapshot);
        expect(publisher.admissions).toEqual(['matvaretabellen:worker']);
    });

    it('pauses with no write and no call to the publisher when the source is busy', async () => {
        const store = new InMemoryMirrorStore();
        const publisher = publisherFeed(() => new Response(publishedText), {
            admitted: false,
            reason: 'ceiling',
            retryAt: '2026-10-02T00:00:00.000Z',
        });

        const result = await syncOf(publisher.feed, store).sync.run();

        expect(result).toEqual({
            outcome: 'paused',
            source: 'matvaretabellen',
            reason: 'ceiling',
            retryAt: '2026-10-02T00:00:00.000Z',
        });
        expect(publisher.upstreamCalls()).toBe(0);
        expect(store.writes).toEqual([]);
    });

    it("writes a 503's block for every task, then fails the run with nothing written", async () => {
        const store = new InMemoryMirrorStore();
        const publisher = publisherFeed(() => new Response('maintenance', { status: 503 }));
        const { sync, completed } = syncOf(publisher.feed, store);

        const thrown = await sync.run().catch((error: unknown) => error);

        expect(isSourceApiError(thrown) && thrown.statusCode).toBe(503);
        expect(publisher.blocks).toEqual([{ source: 'matvaretabellen', reason: 'unavailable', seconds: 60 }]);
        expect(store.writes).toEqual([]);
        expect(completed).toEqual([]);
    });
});
