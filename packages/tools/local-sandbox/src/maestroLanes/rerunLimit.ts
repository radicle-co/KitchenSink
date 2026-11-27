/**
 * The rerun limit of `maestro:lanes`: a flow gets one rerun after a failed run, then a
 * problem report is filed. The door enforces it so nobody has to remember it.
 *
 * A key names one attempt target: platform, iOS device, flow id, HEAD sha and the blob of the flow's own file. A fixed
 * flow or a new commit is a new key, so the limit never blocks work that changed something. Both functions are pure:
 * the door reads and writes the history file (`rerunHistoryStore.ts`) and says what ran.
 *
 * @pattern Specification — `rerunDecision` is one pure predicate over the history that says whether a run may start
 */
import { z } from 'zod';

/** Failed runs of one key after which the next run is refused. */
const RERUN_LIMIT = 2;

/** An entry untouched for this many days is forgotten. */
export const RERUN_HISTORY_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const entrySchema = z.object({
    failures: z.number().int().min(0),
    /** When the key last failed, as an ISO 8601 string. */
    lastAt: z.iso.datetime(),
    /** The problem report references that released this key, one run each. */
    references: z.array(z.string()),
});

/** The file's shape. A file that fails this parse is read as empty. */
export const rerunHistorySchema = z.object({
    version: z.literal(1),
    entries: z.record(z.string(), entrySchema),
});

export type RerunHistory = z.infer<typeof rerunHistorySchema>;

export const EMPTY_RERUN_HISTORY: RerunHistory = { version: 1, entries: {} };

/** The parts of a key. `device` matters on iOS only. */
interface RerunKeyParts {
    readonly platform: string;
    readonly device?: string | undefined;
    readonly flowId: string;
    readonly head: string;
    /** The blob sha of the flow's own YAML file. */
    readonly blob: string;
}

/**
 * The key of one attempt target. Pure.
 *
 * @param parts - The platform, the iOS device, the flow id, the HEAD sha and the flow file's blob sha.
 * @returns One string, equal for equal parts. The device is read for iOS only.
 */
export function rerunKey(parts: RerunKeyParts): string {
    const device = parts.platform === 'ios' ? (parts.device ?? '') : '';

    return [parts.platform, device, parts.flowId, parts.head, parts.blob].join('|');
}

const isFresh = (lastAt: string, now: string): boolean =>
    Date.parse(now) - Date.parse(lastAt) <= RERUN_HISTORY_DAYS * DAY_MS;

/** The history without the entries the window has passed. Pure. */
const prune = (history: RerunHistory, now: string): RerunHistory => ({
    version: 1,
    entries: Object.fromEntries(Object.entries(history.entries).filter(([, entry]) => isFresh(entry.lastAt, now))),
});

/**
 * The failed runs of a key still on record. Pure.
 *
 * @param history - The history.
 * @param key - The key.
 * @returns The count, 0 for a key with no entry.
 */
export const failuresOf = (history: RerunHistory, key: string): number => history.entries[key]?.failures ?? 0;

/** What {@link rerunDecision} is asked. */
interface RerunRequest {
    /** The key of every flow the run will start. */
    readonly keys: readonly string[];
    /** The problem report reference the run was started with. A blank one is none. */
    readonly reference?: string;
    /** The time now, ISO 8601. */
    readonly now: string;
}

type RerunDecision =
    /** `history` is the history to keep: it holds the reference that released a key. */
    | { readonly allowed: true; readonly history: RerunHistory }
    /** `refused` names the keys at their limit; the whole run is refused. */
    | { readonly allowed: false; readonly refused: readonly string[] };

/**
 * May this run start?
 *
 * A key with `RERUN_LIMIT` failed runs is released only by a reference that is not blank and has not released
 * this key before. A reference buys one run: the failures stay, so the next failure is refused again. One refused key
 * refuses the whole run. Pure.
 *
 * @param history - The history read from the file.
 * @param request - The flows' keys, the reference and now.
 * @returns Allowed with the history to keep, or refused with the keys at their limit.
 */
export function rerunDecision(history: RerunHistory, request: RerunRequest): RerunDecision {
    const fresh = prune(history, request.now);
    const reference = request.reference?.trim() ?? '';
    const atLimit = [...new Set(request.keys)].filter((key) => failuresOf(fresh, key) >= RERUN_LIMIT);
    const refused = atLimit.filter(
        (key) => reference === '' || (fresh.entries[key]?.references ?? []).includes(reference),
    );

    if (refused.length > 0) {
        return { allowed: false, refused };
    }

    return {
        allowed: true,
        history: {
            version: 1,
            entries: Object.fromEntries(
                Object.entries(fresh.entries).map(([key, entry]) => [
                    key,
                    atLimit.includes(key) ? { ...entry, references: [...entry.references, reference] } : entry,
                ]),
            ),
        },
    };
}

/** How one flow ended on a lane that ran. */
interface RerunOutcome {
    readonly key: string;
    /** True for a failure, and for a lane that ended before the flow gave a result. */
    readonly failed: boolean;
}

/**
 * The history after a run. A failure adds one and moves the time; a pass forgets the key; entries past the window go.
 * Pure.
 *
 * @param history - The history before the run.
 * @param outcomes - How each flow of a lane that ran ended. A run that never reached a lane has none.
 * @param now - The time now, ISO 8601.
 * @returns The next history.
 */
export function recordOutcomes(history: RerunHistory, outcomes: readonly RerunOutcome[], now: string): RerunHistory {
    const entries = { ...prune(history, now).entries };

    for (const outcome of outcomes) {
        if (!outcome.failed) {
            delete entries[outcome.key];
            continue;
        }

        const before = entries[outcome.key];
        entries[outcome.key] = {
            failures: (before?.failures ?? 0) + 1,
            lastAt: now,
            references: before?.references ?? [],
        };
    }

    return { version: 1, entries };
}
