/**
 * An in-memory {@link MirrorStore}: the mirror table and the sync's recorded source version, with every write logged
 * in order so a test can assert what a sync wrote and when. Phase C's DAO is the real implementation.
 */
import type { MirrorItem } from '../mirrorFeed.js';
import type { MirrorLockResult, MirrorStore } from '../MirrorSync.js';
import type { MirrorSourceId } from '../../sourceRegister.js';

/** One stored item: its version and whether the source has stopped listing it. */
interface StoredItem {
    readonly itemVersion: string;
    readonly name: string;
    readonly vanished: boolean;
}

/** An in-memory mirror store that records every call. */
export class InMemoryMirrorStore implements MirrorStore {
    /** Every write, in order, as `method:detail`. */
    public readonly writes: string[] = [];
    /** Whether another sync holds the lock. */
    public lockHeld = false;
    /** When set, the next `upsertChanged` throws it once, to stand in for a crash mid-sync. */
    public failNextUpsert: Error | undefined;

    private readonly items = new Map<string, StoredItem>();
    private sourceVersion: string | undefined;

    /**
     * @param seed - Items already in the mirror, by key.
     * @param sourceVersion - The source version already recorded.
     */
    public constructor(seed: ReadonlyMap<string, StoredItem> = new Map(), sourceVersion?: string) {
        for (const [key, item] of seed) {
            this.items.set(key, item);
        }

        this.sourceVersion = sourceVersion;
    }

    public async withSyncLock<T>(work: () => Promise<T>): Promise<MirrorLockResult<T>> {
        if (this.lockHeld) {
            return { acquired: false };
        }

        this.lockHeld = true;

        try {
            return { acquired: true, value: await work() };
        } finally {
            this.lockHeld = false;
        }
    }

    public async lastSourceVersion(_source: MirrorSourceId): Promise<string | undefined> {
        return this.sourceVersion;
    }

    public async liveVersions(_source: MirrorSourceId): Promise<ReadonlyMap<string, string>> {
        return new Map(
            [...this.items].flatMap(([key, item]) => (item.vanished ? [] : [[key, item.itemVersion] as const])),
        );
    }

    public async upsertChanged(_source: MirrorSourceId, items: readonly MirrorItem[]): Promise<void> {
        if (this.failNextUpsert !== undefined) {
            const failure = this.failNextUpsert;

            this.failNextUpsert = undefined;
            throw failure;
        }

        for (const item of items) {
            this.items.set(item.externalKey, { itemVersion: item.itemVersion, name: item.name, vanished: false });
        }

        this.writes.push(`upsertChanged:${items.map((item) => item.externalKey).join(',')}`);
    }

    public async markVanished(_source: MirrorSourceId, keys: readonly string[]): Promise<void> {
        for (const key of keys) {
            const item = this.items.get(key);

            if (item !== undefined) {
                this.items.set(key, { ...item, vanished: true });
            }
        }

        this.writes.push(`markVanished:${keys.join(',')}`);
    }

    public async recordSourceVersion(_source: MirrorSourceId, sourceVersion: string): Promise<void> {
        this.sourceVersion = sourceVersion;
        this.writes.push('recordSourceVersion');
    }

    /** The stored item for a key, for assertions. */
    public itemFor(key: string): StoredItem | undefined {
        return this.items.get(key);
    }
}
