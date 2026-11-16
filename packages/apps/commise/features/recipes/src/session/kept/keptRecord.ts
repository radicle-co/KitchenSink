/**
 * @module The kept record, v1 (plan 0003 KTD1): one versioned document per user holding the cook's page ticks,
 * cooking sessions and timers. The format is a one-way door once a client has written it, so every read goes through a
 * strict zod parse. It holds ids, positions, digests, servings and instants only: no label, no recipe text.
 *
 * @pattern Repository — the document schema and its parse/serialize pair are the persistence boundary.
 */
import { MAX_TIMER_MS, MIN_TIMER_MS } from '@kitchensink/cooking-core';
import { z } from 'zod';

export const KEPT_RECORD_VERSION = 1;
export const KEPT_KEY_PREFIX = 'cook.v2.';

/**
 * The storage key of one cook's record.
 *
 * @param clerkUserId - The signed-in cook's id.
 * @returns The storage key of that cook's record (ADR 0004 condition 3).
 */
export const keptKeyFor = (clerkUserId: string): string => `${KEPT_KEY_PREFIX}${clerkUserId}`;

const isoInstant = z.iso.datetime({ offset: true });

const stepRefSchema = z.strictObject({ index: z.int().nonnegative(), digest: z.string().min(1) });

const lineTickSchema = z.strictObject({
    stepIndex: z.int().nonnegative(),
    stepDigest: z.string().min(1),
    lineIndex: z.int().nonnegative(),
});

const pageEntrySchema = z.strictObject({
    kind: z.literal('page'),
    ticks: z.array(z.string()),
    pageStep: stepRefSchema.optional(),
    servings: z.number().positive().optional(),
    lastTouch: isoInstant,
});

const cookingEntrySchema = z.strictObject({
    kind: z.literal('cooking'),
    step: stepRefSchema,
    marks: z.array(stepRefSchema),
    lineTicks: z.array(lineTickSchema),
    ticks: z.array(z.string()),
    servings: z.number().positive().optional(),
    lastTouch: isoInstant,
});

const keptEntrySchema = z.discriminatedUnion('kind', [pageEntrySchema, cookingEntrySchema]);

const timerBase = {
    id: z.uuid({ version: 'v7' }),
    recipeId: z.string().min(1),
    stepIndex: z.int().nonnegative(),
    stepDigest: z.string().min(1),
    ordinal: z.int().positive(),
    /** Which run of the timer this is, the key `ended` is told once for (cooking-core `TimerBase.run`). */
    run: z.int().positive(),
    /** The length of the current run, in the bounds `reduceTimer` accepts, so a timer the reducer would refuse is not stored. */
    durationMs: z.int().min(MIN_TIMER_MS).max(MAX_TIMER_MS),
};

/** `ringing` and `endedAway` carry the instant the timer ended. The reducer ends a timer at its own end, so no second instant is stored. */
const endedShape = { ...timerBase, endedAt: isoInstant };

/**
 * A timer is a union on `state`, each state with exactly the instants it needs, so a running timer with no end cannot
 * be written. No label field: a strict object refuses one (R8a).
 */
export const keptTimerSchema = z.discriminatedUnion('state', [
    z.strictObject({ ...timerBase, state: z.literal('running'), endsAt: isoInstant }),
    z.strictObject({
        ...timerBase,
        state: z.literal('paused'),
        remainingMs: z.number().nonnegative(),
        pausedAt: isoInstant,
    }),
    z.strictObject({ ...endedShape, state: z.literal('ringing') }),
    /** `announcedAt` is S4b's, written only for the ended-away announcement (plan 0004 KTD7). */
    z.strictObject({ ...endedShape, state: z.literal('endedAway'), announcedAt: isoInstant.optional() }),
]);

/** Timers are parsed one by one afterwards, so one bad timer does not cost every session. */
const keptDocumentSchema = z.strictObject({
    v: z.literal(KEPT_RECORD_VERSION),
    rev: z.int().nonnegative(),
    entries: z.record(z.string(), keptEntrySchema),
    timers: z.array(z.unknown()),
});

export type StepMark = z.infer<typeof stepRefSchema>;
export type LineTickRef = z.infer<typeof lineTickSchema>;
export type KeptEntry = z.infer<typeof keptEntrySchema>;
export type KeptTimer = z.infer<typeof keptTimerSchema>;
export type CookingEntry = Extract<KeptEntry, { kind: 'cooking' }>;
export type PausedTimer = Extract<KeptTimer, { state: 'paused' }>;
export type RunningTimer = Extract<KeptTimer, { state: 'running' }>;

export interface KeptDocument {
    readonly v: 1;
    readonly rev: number;
    readonly entries: Readonly<Record<string, KeptEntry>>;
    readonly timers: readonly KeptTimer[];
}

export const EMPTY_KEPT_DOCUMENT: KeptDocument = { v: 1, rev: 0, entries: {}, timers: [] };

export type ParsedKept =
    | { readonly kind: 'absent' }
    /** The store removes the key (R2a). */
    | { readonly kind: 'invalid' }
    | { readonly kind: 'ok'; readonly doc: KeptDocument; readonly droppedTimerIds: readonly string[] };

function readableId(raw: unknown): string | undefined {
    if (typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string') {
        return raw.id;
    }

    return undefined;
}

/**
 * Reads the stored record.
 *
 * @param raw - The stored string, or null when the key is absent.
 * @returns `absent`; `invalid` for unparseable JSON or a document that fails the schema; else the document with every
 * bad timer dropped and a duplicate id kept once (the first), and the dropped ids listed so the store can report once.
 */
export function parseKeptDocument(raw: string | null): ParsedKept {
    if (raw === null) {
        return { kind: 'absent' };
    }

    let json: unknown;

    try {
        json = JSON.parse(raw);
    } catch {
        return { kind: 'invalid' };
    }

    const parsed = keptDocumentSchema.safeParse(json);

    if (!parsed.success) {
        return { kind: 'invalid' };
    }

    const timers: KeptTimer[] = [];
    const droppedTimerIds: string[] = [];
    const seen = new Set<string>();

    for (const candidate of parsed.data.timers) {
        const timer = keptTimerSchema.safeParse(candidate);

        if (timer.success && !seen.has(timer.data.id)) {
            seen.add(timer.data.id);
            timers.push(timer.data);
        } else {
            const id = timer.success ? timer.data.id : readableId(candidate);

            if (id !== undefined) {
                droppedTimerIds.push(id);
            }
        }
    }

    return { kind: 'ok', doc: { ...parsed.data, timers }, droppedTimerIds };
}

/**
 * Writes a document to the string the store saves.
 *
 * @param doc - A document.
 * @returns The string the store writes.
 */
export function serializeKeptDocument(doc: KeptDocument): string {
    return JSON.stringify(doc);
}
