import { z } from 'zod';

import { isoDateTimeSchema } from '@kitchensink/recipe-core';

import { ALLOWED_SCALE_FACTORS } from './types.js';
import type { CookingSession } from './types.js';

/**
 * T-013 / MOD-010 — session persistence and the 24h resume window (FR-033 / REQ-013, plan.md §8).
 *
 * **Ports and adapters.** This package is platform-free, so device storage arrives as the
 * {@link CookingSessionStore} port; the IndexedDB (web) and AsyncStorage (native) adapters implement it
 * in their own packages. Nothing here imports a web or React Native API, and nothing here reads a
 * clock — `now` is injected, which is what makes the 24h boundary testable to the millisecond.
 *
 * **The persisted format is a versioned envelope**, `{ version, session }`. A persisted schema is one of
 * the expensive-to-reverse boundaries CLAUDE.md calls out: once real devices hold bytes, a shape change
 * with no version tag can only be detected as "corrupt" by luck. The tag makes the next change a
 * deliberate, detectable migration instead of a silent misread.
 *
 * **Validation is symmetric, and it is the whole point.** {@link deserializeSession} parses (never
 * merely casts) whatever the device returns, and {@link serializeSession} runs the SAME schema before a
 * byte is written. An asymmetric validator — write anything, read strictly — is a landmine: it destroys
 * a cook's session at restore time, hours after the bug was introduced, with no way to recover the data.
 * Failing at write time surfaces the same bug immediately and loses nothing.
 *
 * **Arrays, never `Set`s.** `JSON.stringify(new Set([1, 2]))` is `{}`. The schema rejects that shape
 * outright, so a regression to a `Set` cannot quietly erase a cook's completed steps or ingredient
 * checkoff on resume (plan.md §2 "Serializability").
 */

/**
 * The resume window: a session whose age exceeds this is discarded rather than offered (plan.md §8).
 *
 * "Older than" is strict — a session at exactly 24h is still resumable. The boundary is asserted from
 * both sides in the unit suite.
 */
export const SESSION_RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Schema version of the persisted envelope. Increment it whenever {@link CookingSession}'s persisted
 * shape changes in a way an older build cannot read; entries carrying any other version are treated as
 * unreadable and evicted.
 */
export const PERSISTED_SESSION_SCHEMA_VERSION = 1;

/**
 * Device-storage port for cooking sessions — IndexedDB on web, AsyncStorage on native.
 *
 * Keyed by `recipeId`: one in-progress session per recipe. Namespacing keys, quota handling and any
 * platform serialization concern belong to the adapter, not here. A rejected promise means the storage
 * layer failed and MUST surface — it is never the same thing as "there is no session".
 */
export interface CookingSessionStore {
    /**
     * Reads the serialized session for a recipe.
     *
     * @param recipeId - Recipe whose session to read.
     * @returns The serialized payload, or `null` when the device holds none.
     */
    read(recipeId: string): Promise<string | null>;

    /**
     * Writes the serialized session for a recipe, replacing any previous entry.
     *
     * @param recipeId - Recipe whose session to write.
     * @param serialized - The payload produced by {@link serializeSession}.
     */
    write(recipeId: string, serialized: string): Promise<void>;

    /**
     * Removes any stored session for a recipe. Removing a key that does not exist is not an error.
     *
     * @param recipeId - Recipe whose session to remove.
     */
    remove(recipeId: string): Promise<void>;
}

/** Raised when a persisted cooking-session payload cannot be read back as a valid {@link CookingSession}. */
export class CorruptSessionError extends Error {
    public constructor(
        /** Human-readable detail of what failed validation. */
        public readonly detail: string,
        options?: { cause?: unknown },
    ) {
        super(`Corrupt cooking session payload: ${detail}`, options);
        this.name = 'CorruptSessionError';
        Object.setPrototypeOf(this, CorruptSessionError.prototype);
    }
}

/**
 * Type guard for {@link CorruptSessionError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is a {@link CorruptSessionError}.
 */
export function isCorruptSessionError(error: unknown): error is CorruptSessionError {
    return error instanceof CorruptSessionError;
}

/** Raised when a timestamp argument supplied by the caller is not a parseable ISO 8601 string. */
export class InvalidTimestampError extends Error {
    public constructor(public readonly value: string) {
        super(`Invalid ISO 8601 timestamp: ${value}`);
        this.name = 'InvalidTimestampError';
        Object.setPrototypeOf(this, InvalidTimestampError.prototype);
    }
}

/**
 * Type guard for {@link InvalidTimestampError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidTimestampError}.
 */
export function isInvalidTimestampError(error: unknown): error is InvalidTimestampError {
    return error instanceof InvalidTimestampError;
}

/** Why no session is available to resume. Each reason lands the caller on the same "start fresh" path. */
export type SessionUnavailableReason =
    /** The device holds no session for this recipe. */
    | 'absent'
    /** A session existed but fell outside {@link SESSION_RESUME_WINDOW_MS}; it has been evicted. */
    | 'expired'
    /** The stored payload could not be parsed, was written by another schema version, or described a
     * different recipe; it has been evicted. */
    | 'unreadable';

/**
 * The outcome of a resume attempt — a discriminated union so the caller cannot read `session` on a
 * path where there is none (plan.md §8: prompt to resume, otherwise start fresh).
 */
export type SessionRestoreOutcome =
    | { readonly status: 'resumable'; readonly session: CookingSession }
    | { readonly status: 'start-fresh'; readonly reason: SessionUnavailableReason };

/** Timer validator. Mirrors `CookingTimer` — structural, plus the invariants the type cannot express. */
const cookingTimerSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    stepNumber: z.number().int().nonnegative(),
    // Derived from `RecipeStep.timerSeconds * 1000`; `Infinity`/`NaN` would freeze a countdown forever.
    durationMs: z.number().finite().nonnegative(),
    startedAt: isoDateTimeSchema,
    isPaused: z.boolean(),
    pausedRemainingMs: z.number().finite().nonnegative().optional(),
    // Load-bearing, and easy to omit by accident: `z.object` STRIPS unknown keys, so leaving `alertedAt`
    // out of the schema would silently discard the completion acknowledgement on every write. A session
    // restored after an interruption would then re-announce a timer that finished before it (REQ-006's
    // "once" is exactly what the field exists to make survive a resume — see `CookingTimer.alertedAt`).
    alertedAt: isoDateTimeSchema.optional(),
});

/**
 * Session validator. `z.array(...)` is what rejects a `Set` that crossed JSON as `{}`; `z.literal` over
 * {@link ALLOWED_SCALE_FACTORS} is what keeps an illegal scale factor unrepresentable after a restore.
 */
const cookingSessionSchema = z.object({
    recipeId: z.string().min(1),
    startedAt: isoDateTimeSchema,
    currentStepIndex: z.number().int().nonnegative(),
    completedSteps: z.array(z.number().int().nonnegative()),
    checkedIngredientIds: z.array(z.string().min(1)),
    scaleFactor: z.literal(ALLOWED_SCALE_FACTORS),
    activeTimers: z.array(cookingTimerSchema),
    pausedAt: isoDateTimeSchema.optional(),
});

/** The persisted envelope. The version tag is checked before the session body is trusted. */
const persistedEnvelopeSchema = z.object({
    version: z.literal(PERSISTED_SESSION_SCHEMA_VERSION),
    session: cookingSessionSchema,
});

/**
 * Parses an ISO 8601 timestamp to epoch milliseconds.
 *
 * @param value - The timestamp to parse.
 * @returns Epoch milliseconds.
 * @throws {InvalidTimestampError} When `value` is not a parseable ISO 8601 timestamp.
 */
function toEpochMs(value: string): number {
    const epochMs = Date.parse(value);

    if (Number.isNaN(epochMs)) {
        throw new InvalidTimestampError(value);
    }

    return epochMs;
}

/**
 * Serializes a cooking session to the persisted envelope.
 *
 * The session is validated against the same schema {@link deserializeSession} enforces, so anything
 * this function writes is guaranteed readable — see the module docstring on symmetric validation.
 *
 * @param session - The live session to persist.
 * @returns The serialized payload to hand to {@link CookingSessionStore.write}.
 * @throws {CorruptSessionError} When `session` violates its own contract and could not be read back.
 */
export function serializeSession(session: CookingSession): string {
    const validated = cookingSessionSchema.safeParse(session);

    if (!validated.success) {
        throw new CorruptSessionError(
            `refusing to persist an unreadable session (${z.prettifyError(validated.error)})`,
            { cause: validated.error },
        );
    }

    return JSON.stringify({ version: PERSISTED_SESSION_SCHEMA_VERSION, session: validated.data });
}

/**
 * Parses a persisted payload back into a cooking session.
 *
 * Unknown keys are dropped rather than carried through, so a field written by a different build (or a
 * `__proto__` key smuggled through `JSON.parse`) never reaches the returned object.
 *
 * @param raw - The payload returned by {@link CookingSessionStore.read}.
 * @returns The validated session.
 * @throws {CorruptSessionError} When `raw` is not JSON, carries another schema version, or is not a
 * complete, well-typed {@link CookingSession}.
 */
export function deserializeSession(raw: string): CookingSession {
    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch (error: unknown) {
        throw new CorruptSessionError('payload is not valid JSON', { cause: error });
    }

    const envelope = persistedEnvelopeSchema.safeParse(parsed);

    if (!envelope.success) {
        throw new CorruptSessionError(z.prettifyError(envelope.error), { cause: envelope.error });
    }

    const { session } = envelope.data;

    // Rebuilt field by field rather than spread: `pausedAt` is optional and must stay ABSENT (not
    // `undefined`) so a persist → restore → persist cycle produces byte-identical payloads.
    return {
        recipeId: session.recipeId,
        startedAt: session.startedAt,
        currentStepIndex: session.currentStepIndex,
        completedSteps: [...session.completedSteps],
        checkedIngredientIds: [...session.checkedIngredientIds],
        scaleFactor: session.scaleFactor,
        activeTimers: session.activeTimers.map((timer) => ({ ...timer })),
        ...(session.pausedAt === undefined ? {} : { pausedAt: session.pausedAt }),
    };
}

/**
 * Persists a session to device storage, replacing any previous session for the same recipe.
 *
 * @param store - The device-storage port.
 * @param session - The live session to persist.
 * @returns Resolves once the write completes.
 * @throws {CorruptSessionError} When `session` could not be read back (validated before the write).
 * @sideEffect Writes to device storage.
 */
export async function persistSession(store: CookingSessionStore, session: CookingSession): Promise<void> {
    // Serialize (and therefore validate) BEFORE touching storage: a rejected session must leave any
    // previously-persisted good session intact rather than replacing it with garbage.
    const serialized = serializeSession(session);

    await store.write(session.recipeId, serialized);
}

/**
 * Attempts to resume the stored session for a recipe (plan.md §8, FR-033).
 *
 * A session is resumable when its age — measured from `pausedAt` if the user exited mid-session, else
 * from `startedAt` — does not exceed {@link SESSION_RESUME_WINDOW_MS}. Anything else resolves to
 * `start-fresh`, and any entry that will never become resumable again (expired, unreadable, belonging
 * to another recipe) is evicted so the next cold start does not re-evaluate it and the device does not
 * accumulate dead sessions.
 *
 * A storage failure is deliberately NOT converted into `start-fresh`: "we could not read" is not "there
 * is nothing to read", and silently starting fresh would discard a cook's progress over a transient
 * fault. The rejection propagates to the caller.
 *
 * @param store - The device-storage port.
 * @param recipeId - Recipe whose session to resume.
 * @param nowIso - Current time as an ISO 8601 timestamp, injected so the window is deterministic.
 * @returns Whether a session is resumable, and if not, why.
 * @throws {InvalidTimestampError} When `nowIso` is not a parseable ISO 8601 timestamp.
 * @sideEffect Reads from, and may delete from, device storage.
 */
export async function restoreSession(
    store: CookingSessionStore,
    recipeId: string,
    nowIso: string,
): Promise<SessionRestoreOutcome> {
    // Parsed first: a caller bug in `nowIso` must not cause a stored session to be evicted.
    const nowMs = toEpochMs(nowIso);
    const raw = await store.read(recipeId);

    if (raw === null) {
        return { status: 'start-fresh', reason: 'absent' };
    }

    let session: CookingSession;

    try {
        session = deserializeSession(raw);
    } catch (error: unknown) {
        // Only a corrupt payload is self-healed here. Anything else (a storage fault) propagates.
        if (!isCorruptSessionError(error)) {
            throw error;
        }

        await store.remove(recipeId);

        return { status: 'start-fresh', reason: 'unreadable' };
    }

    if (session.recipeId !== recipeId) {
        // A key collision or a mis-keyed adapter write. Resuming would drop the cook into another
        // recipe's step list, so the entry is treated as unusable rather than trusted.
        await store.remove(recipeId);

        return { status: 'start-fresh', reason: 'unreadable' };
    }

    // `pausedAt` marks the moment the user actually left; `startedAt` is the fallback for a session the
    // app never got to pause (a kill or a crash), which plan.md §8 leaves undefined.
    const ageMs = nowMs - toEpochMs(session.pausedAt ?? session.startedAt);

    // A negative age means the device clock moved backwards (skew, timezone fix). Forgiving by design:
    // treating it as expired would throw away a session that is, by every other measure, current.
    if (ageMs > SESSION_RESUME_WINDOW_MS) {
        await store.remove(recipeId);

        return { status: 'start-fresh', reason: 'expired' };
    }

    return { status: 'resumable', session };
}

/**
 * Clears the stored session for a recipe — the "start fresh" path, and the end-of-cook cleanup.
 *
 * Idempotent: clearing a recipe with no stored session is a no-op, not an error.
 *
 * @param store - The device-storage port.
 * @param recipeId - Recipe whose session to clear.
 * @returns Resolves once the entry is gone.
 * @sideEffect Deletes from device storage.
 */
export async function clearSession(store: CookingSessionStore, recipeId: string): Promise<void> {
    await store.remove(recipeId);
}
