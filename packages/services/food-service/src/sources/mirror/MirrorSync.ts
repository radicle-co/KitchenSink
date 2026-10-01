/**
 * One run of a mirror source's sync (plan U28, R60, KTD-26). The mirror is a cache, never catalog: the sync writes
 * mirror rows and nothing else, and the seed never reads them.
 *
 * The order is fixed here, and the feed (Strategy) and the store, drift and metric ports vary:
 *
 * 1. take the one-sync-at-a-time lock, or do nothing;
 * 2. pull the source, and on `SourceBusyError` pause, writing nothing (ADR-0053 §4);
 * 3. check drift against the committed extract, on every successful pull, so a drift report repeats until a seed pull
 *    request answers it;
 * 4. when the source version is unchanged, write nothing;
 * 5. otherwise write the changed and reappearing items, mark the vanished ones, and write the source version LAST;
 * 6. report the drift, and emit `MirrorSyncCompleted`.
 *
 * Writing the source version last is what makes the run safe to interrupt: a crash between writes leaves the old
 * version recorded, so the next run diffs again, and re-writing an item it already wrote is a no-op diff, not a
 * duplicate. An unchanged run still completes, because the staleness alarm counts completed syncs and a table that
 * changes yearly must not read as stale every day.
 *
 * @pattern Template Method — the run order is fixed; the feed and the ports vary
 * @module
 */
import { isSourceBusyError, type SourceBusyReason } from '../foodSource.errors.js';
import type { MirrorSourceId } from '../sourceRegister.js';
import type { MirrorDrift } from './extractDrift.js';
import type { MirrorFeed, MirrorItem, MirrorPull } from './mirrorFeed.js';

/** Whether the sync lock was taken, and the work's result when it was. */
export type MirrorLockResult<T> = { readonly acquired: true; readonly value: T } | { readonly acquired: false };

/** Where the mirror and its sync state are kept. */
export interface MirrorStore {
    /**
     * Run work under the one-sync-at-a-time lock, without waiting for it.
     *
     * @param work - The sync.
     * @returns The work's result, or `{ acquired: false }` without running it when another sync holds the lock.
     * @sideEffect Takes and releases the lock.
     */
    withSyncLock<T>(work: () => Promise<T>): Promise<MirrorLockResult<T>>;
    /**
     * @param source - The source.
     * @returns The source version the last completed sync recorded, or `undefined` before the first.
     * @sideEffect Reads the sync state.
     */
    lastSourceVersion(source: MirrorSourceId): Promise<string | undefined>;
    /**
     * @param source - The source.
     * @returns Each item the source still lists, by key, with its version. A vanished item is not live.
     * @sideEffect Reads the mirror.
     */
    liveVersions(source: MirrorSourceId): Promise<ReadonlyMap<string, string>>;
    /**
     * @param source - The source.
     * @param items - Items to write, clearing any vanished mark.
     * @sideEffect Writes mirror rows.
     */
    upsertChanged(source: MirrorSourceId, items: readonly MirrorItem[]): Promise<void>;
    /**
     * @param source - The source.
     * @param keys - Items the source no longer lists. They are marked, never deleted.
     * @sideEffect Writes mirror rows.
     */
    markVanished(source: MirrorSourceId, keys: readonly string[]): Promise<void>;
    /**
     * @param source - The source.
     * @param sourceVersion - The version of the pull just written.
     * @sideEffect Writes the sync state.
     */
    recordSourceVersion(source: MirrorSourceId, sourceVersion: string): Promise<void>;
}

/** Where a completed sync is counted, for the staleness alarm. */
export interface MirrorSyncMetrics {
    /**
     * @param source - The source whose sync completed, changed or not.
     * @sideEffect Emits `MirrorSyncCompleted`.
     */
    mirrorSyncCompleted(source: MirrorSourceId): void;
}

/** What a sync is built over. */
export interface MirrorSyncPorts {
    readonly feed: MirrorFeed;
    readonly store: MirrorStore;
    /** Compares a pull's cited items with the committed extract. */
    readonly drift: (items: readonly MirrorItem[]) => readonly MirrorDrift[];
    readonly metrics: MirrorSyncMetrics;
}

/** What one run did. */
export type MirrorSyncResult =
    | { readonly outcome: 'locked'; readonly source: MirrorSourceId }
    | {
          readonly outcome: 'paused';
          readonly source: MirrorSourceId;
          readonly reason: SourceBusyReason;
          readonly retryAt: string;
      }
    | {
          readonly outcome: 'unchanged';
          readonly source: MirrorSourceId;
          readonly sourceVersion: string;
          readonly drift: readonly MirrorDrift[];
      }
    | {
          readonly outcome: 'synced';
          readonly source: MirrorSourceId;
          readonly sourceVersion: string;
          /** How many items were written. */
          readonly changed: number;
          /** The keys the source stopped listing, in key order. */
          readonly vanished: readonly string[];
          readonly drift: readonly MirrorDrift[];
      };

/** One source's mirror sync. */
export class MirrorSync {
    /**
     * @param ports - The feed, the store, the drift check and the metric sink.
     */
    public constructor(private readonly ports: MirrorSyncPorts) {}

    /**
     * Run the sync once.
     *
     * @returns What the run did.
     * @throws Any feed failure other than a busy source, and any store failure, unchanged. The source version is then
     *   not recorded, so the next run diffs again.
     * @sideEffect Reads the source and writes the mirror.
     */
    public async run(): Promise<MirrorSyncResult> {
        const { source } = this.ports.feed;
        const locked = await this.ports.store.withSyncLock(async () => this.syncUnderLock());

        return locked.acquired ? locked.value : { outcome: 'locked', source };
    }

    /**
     * The sync, under the lock.
     *
     * @returns What the run did.
     * @sideEffect Reads the source and writes the mirror.
     */
    private async syncUnderLock(): Promise<MirrorSyncResult> {
        const { feed, store, metrics } = this.ports;
        const { source } = feed;
        let pull: MirrorPull;

        try {
            pull = await feed.pull();
        } catch (error) {
            if (isSourceBusyError(error)) {
                return { outcome: 'paused', source, reason: error.reason, retryAt: error.retryAt };
            }

            throw error;
        }

        // Before any write, so a mapper bug fails the run with nothing written.
        const drift = this.ports.drift(pull.items);

        if ((await store.lastSourceVersion(source)) === pull.sourceVersion) {
            metrics.mirrorSyncCompleted(source);

            return { outcome: 'unchanged', source, sourceVersion: pull.sourceVersion, drift };
        }

        const live = await store.liveVersions(source);
        const changed = pull.items.filter((item) => live.get(item.externalKey) !== item.itemVersion);
        const listed = new Set(pull.items.map((item) => item.externalKey));
        const vanished = [...live.keys()].filter((key) => !listed.has(key)).sort();

        if (changed.length > 0) {
            await store.upsertChanged(source, changed);
        }

        if (vanished.length > 0) {
            await store.markVanished(source, vanished);
        }

        // Last, so an interrupted run leaves the previous version and the next run diffs again.
        await store.recordSourceVersion(source, pull.sourceVersion);
        metrics.mirrorSyncCompleted(source);

        return {
            outcome: 'synced',
            source,
            sourceVersion: pull.sourceVersion,
            changed: changed.length,
            vanished,
            drift,
        };
    }
}
