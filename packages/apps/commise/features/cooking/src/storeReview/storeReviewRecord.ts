/**
 * @module @commise/features-cooking/storeReview — the per-user store-review record (S12 U2, plan 0011 KTD2): how many
 * recipes a cook finished on this device, and when the app last asked them for a store rating.
 *
 * One device key holds a map from user id to `{ finishes, lastRequestAt? }`, so a plain sign-out keeps the cook's entry
 * and another cook signing in neither reads nor changes it. The record is read entry by entry: a bad entry reads as not
 * loaded, so the policy refuses, and the next finish heals only that entry as "just asked" (an error that leans toward
 * not asking for 120 days, never toward asking early). Every other entry, valid or bad, is left as it is.
 *
 * Only the close and erase sequences remove an entry (`clear`), at their composition points in the mobile app. This
 * module never learns why it was called.
 *
 * @pattern Repository — the record behind the device storage port, under one key.
 * @pattern Unit of Work — each write re-reads the key and writes it once, inside one exclusive section.
 */
import type { ErrorReporter } from '@commise/features-core';
import type { ExclusiveRunner, KeptPort } from '@commise/features-recipes/session';
import { z } from 'zod';

/** The device key. Outside the kept cooking-session store's own prefix, so its sign-in clear never reaches it. */
export const STORE_REVIEW_KEY = 'commise.storeReview.v1';

/** The lock name every read-modify-write holds. */
const LOCK_NAME = 'commise.storeReview';

const entrySchema = z.object({
    finishes: z.number().int().nonnegative(),
    lastRequestAt: z.iso.datetime({ offset: true }).optional(),
});

/** One cook's record: finishes counted on this device, and the instant of the last request, if one was made. */
export interface StoreReviewEntry {
    readonly finishes: number;
    readonly lastRequestAt?: string;
}

/** What the record needs from the app. */
export interface StoreReviewRecordDeps {
    readonly port: KeptPort;
    readonly exclusive: ExclusiveRunner;
    /** The current instant as an ISO 8601 string. */
    readonly now: () => string;
    /** Receives a failure with no user content. */
    readonly report: ErrorReporter;
}

/** The record's commands. None throws: a failure is reported and answered as `undefined`, or returns for `clear`. */
export interface StoreReviewRecord {
    /** The cook's entry; `{ finishes: 0 }` when none is stored; `undefined` when it cannot be trusted or read. */
    read(userId: string): Promise<StoreReviewEntry | undefined>;
    /** Counts one finish. `undefined` when the storage could not be read or written. */
    recordFinish(userId: string): Promise<StoreReviewEntry | undefined>;
    /** Notes that the app asked just now. `undefined` when the storage could not be read or written. */
    recordRequest(userId: string): Promise<StoreReviewEntry | undefined>;
    /** Removes the cook's entry, whether valid or not. Never rejects, so a close or an erase is never stranded by it. */
    clear(userId: string | undefined): Promise<void>;
}

/** The key's parsed map, or why there is none: `absent` (no key) or `unreadable` (stored, not a JSON object). */
type RawMap =
    { readonly kind: 'map'; readonly map: Record<string, unknown> } | { readonly kind: 'absent' | 'unreadable' };

function parseMap(raw: string | null): RawMap {
    if (raw === null) {
        return { kind: 'absent' };
    }

    try {
        const parsed: unknown = JSON.parse(raw);

        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? { kind: 'map', map: { ...(parsed as Record<string, unknown>) } }
            : { kind: 'unreadable' };
    } catch {
        return { kind: 'unreadable' };
    }
}

/**
 * Builds the record.
 *
 * @param deps - The storage port, the exclusion, the clock and the reporter.
 * @returns The record. Not pure: it reads and writes the port and reports through `report`.
 * @sideEffect Reads and writes the device key; reports a bad entry once per cook while it stays bad.
 */
export function createStoreReviewRecord(deps: StoreReviewRecordDeps): StoreReviewRecord {
    const { port, exclusive, now, report } = deps;
    // Cooks whose bad entry was already reported: a bad entry is reported once, not on every read.
    const reportedBad = new Set<string>();

    const load = async (): Promise<RawMap | undefined> => {
        try {
            return parseMap(await port.read(STORE_REVIEW_KEY));
        } catch (error) {
            report(error, { source: 'storeReviewRecord', step: 'read' });

            return undefined;
        }
    };

    const entryOf = (map: RawMap, userId: string): StoreReviewEntry | 'bad' => {
        if (map.kind !== 'map') {
            return map.kind === 'absent' ? { finishes: 0 } : 'bad';
        }

        if (!(userId in map.map)) {
            return { finishes: 0 };
        }

        const parsed = entrySchema.safeParse(map.map[userId]);

        return parsed.success ? parsed.data : 'bad';
    };

    const reportBadOnce = (userId: string): void => {
        if (!reportedBad.has(userId)) {
            reportedBad.add(userId);
            report(new Error('A store-review entry failed its schema.'), {
                source: 'storeReviewRecord',
                step: 'parse',
            });
        }
    };

    const read = async (userId: string): Promise<StoreReviewEntry | undefined> => {
        const map = await load();

        if (map === undefined) {
            return undefined;
        }

        const entry = entryOf(map, userId);

        if (entry === 'bad') {
            reportBadOnce(userId);

            return undefined;
        }

        return entry;
    };

    /** One read-modify-write of this cook's entry, in the exclusive section. */
    const update = (userId: string, change: (current: StoreReviewEntry | 'bad') => StoreReviewEntry) =>
        exclusive(LOCK_NAME, async (): Promise<StoreReviewEntry | undefined> => {
            const loaded = await load();

            if (loaded === undefined) {
                return undefined;
            }

            const current = entryOf(loaded, userId);

            if (current === 'bad') {
                reportBadOnce(userId);
            }

            const next = change(current);
            const base = loaded.kind === 'map' ? loaded.map : {};
            const written = await port.write(STORE_REVIEW_KEY, JSON.stringify({ ...base, [userId]: next }));

            if (!written.ok) {
                report(written.error, { source: 'storeReviewRecord', step: 'write' });

                return undefined;
            }

            reportedBad.delete(userId);

            return next;
        });

    // A bad entry heals as just asked: it never reads as never asked.
    const healed = (): StoreReviewEntry => ({ finishes: 1, lastRequestAt: now() });

    return {
        read,
        recordFinish: (userId) =>
            update(userId, (current) =>
                current === 'bad'
                    ? healed()
                    : {
                          finishes: current.finishes + 1,
                          ...(current.lastRequestAt === undefined ? {} : { lastRequestAt: current.lastRequestAt }),
                      },
            ),
        recordRequest: (userId) =>
            update(userId, (current) =>
                current === 'bad' ? healed() : { finishes: current.finishes, lastRequestAt: now() },
            ),
        clear: async (userId) => {
            if (userId === undefined) {
                return;
            }

            try {
                await exclusive(LOCK_NAME, async () => {
                    const loaded = await load();

                    if (loaded === undefined || loaded.kind !== 'map' || !(userId in loaded.map)) {
                        return;
                    }

                    const { [userId]: _removed, ...rest } = loaded.map;

                    if (Object.keys(rest).length === 0) {
                        await port.remove(STORE_REVIEW_KEY);
                    } else {
                        const written = await port.write(STORE_REVIEW_KEY, JSON.stringify(rest));

                        if (!written.ok) {
                            report(written.error, { source: 'storeReviewRecord', step: 'clear' });
                        }
                    }

                    reportedBad.delete(userId);
                });
            } catch (error) {
                report(error, { source: 'storeReviewRecord', step: 'clear' });
            }
        },
    };
}
