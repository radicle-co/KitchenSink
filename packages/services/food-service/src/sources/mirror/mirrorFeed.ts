/**
 * How a mirror source is read (plan KTD-26, R60). A source whose API can only list or fetch by id is searched through
 * a local mirror, and a `MirrorFeed` is that source's way of listing every item it holds. A feed is bound to its
 * transport when it is built, so a feed built with none, the committed snapshot, cannot reach the network.
 *
 * {@link mirrorPullOf} is the one step every feed shares: it versions each item by its content and the pull by its
 * items, and refuses a listing whose keys repeat or whose items have no name.
 *
 * @pattern Strategy — one feed per source and origin (the publisher, or the committed snapshot)
 * @module
 */
import type { MirrorSourceId } from '../sourceRegister.js';
import { itemVersion } from './itemVersion.js';
import { MirrorFeedFormatError } from './mirrorFeed.errors.js';

/** One item a source lists. */
export interface MirrorItem {
    /** The source's own key for the item, trimmed. */
    readonly externalKey: string;
    /** The item's name in the source, trimmed. */
    readonly name: string;
    /** The SHA-256 of the payload's canonical form. */
    readonly itemVersion: string;
    /** The item exactly as the source published it. */
    readonly payload: Readonly<Record<string, unknown>>;
}

/** Every item one source lists, and one version for them all. */
export interface MirrorPull {
    /** Derived from the items' keys and versions, so equal content always has an equal version. */
    readonly sourceVersion: string;
    readonly items: readonly MirrorItem[];
}

/** One source's listing. */
export interface MirrorFeed {
    readonly source: MirrorSourceId;
    /**
     * List every item the source holds.
     *
     * @returns The pull.
     * @throws {SourceBusyError} when the source is at its limit or blocked; the sync pauses.
     * @throws {MirrorFeedFormatError} when the listing is not the shape the feed was written for.
     * @sideEffect Reads the source, through its transport or from a committed file.
     */
    pull(): Promise<MirrorPull>;
}

/** An item before it is versioned. */
export type MirrorEntry = Omit<MirrorItem, 'itemVersion'>;

/**
 * Version a source's listing. Pure.
 *
 * @param entries - Every item the source lists, in any order.
 * @returns The pull.
 * @throws {MirrorFeedFormatError} when a key is empty or repeats, or a name is blank.
 */
export function mirrorPullOf(entries: readonly MirrorEntry[]): MirrorPull {
    const seen = new Set<string>();
    const items: MirrorItem[] = [];

    for (const [index, entry] of entries.entries()) {
        if (entry.externalKey === '') {
            throw new MirrorFeedFormatError(`item ${String(index + 1)}`, 'has an empty key');
        }

        if (seen.has(entry.externalKey)) {
            throw new MirrorFeedFormatError(entry.externalKey, 'is held twice, so it names no one item');
        }

        if (entry.name.trim() === '') {
            throw new MirrorFeedFormatError(entry.externalKey, 'has a blank name');
        }

        seen.add(entry.externalKey);
        items.push({ ...entry, itemVersion: itemVersion(entry.payload) });
    }

    const keyed = items
        .map((item) => [item.externalKey, item.itemVersion] as const)
        .sort(([left], [right]) => (left < right ? -1 : 1));

    return { sourceVersion: itemVersion(keyed), items };
}
