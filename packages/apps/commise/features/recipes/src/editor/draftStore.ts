/**
 * @module @commise/features-recipes/editor — the editor's device draft: a Memento of the form, kept on the device.
 *
 * The editor writes it on every trigger (`checkpointPolicy.ts`), for every recipe, and seeds from it on reopen. It is
 * behind the key/value port (`OutboxStore`, `@kitchensink/sync`) with one adapter per platform, chosen by the app:
 * AsyncStorage on mobile, `sessionStorage` on web (owner ruling D7, through `createWebStorageStore`).
 *
 * ⛔ THE PERSISTED FORMAT IS A ONE-WAY DOOR (ADR-0057). A release that cannot read what an older one wrote must neither
 * lose it nor trust it, so:
 *
 * - **ids and form values only** (D7). No pending photo picks (their bytes are not in the form), no nutrition, nothing
 *   the server derives. The schema is strict: a field this format does not have makes the draft unreadable;
 * - **one key per user**, versioned: `editor.draft.v1.{subject}`, holding every draft. One key makes a rekey and an
 *   eviction atomic, and makes the session-end clear (ADR-0054) one `removeItem`, which the port — it cannot list
 *   keys — could not do over a key per recipe;
 * - **unreadable bytes are quarantined** under `editor.draft.quarantine.{subject}` the first time they are read, and
 *   the main key starts empty. Nothing but a clear removes the quarantine;
 * - **at most {@link MAX_KEPT_DRAFTS}**, the least recently saved going first, so an abandoned draft cannot grow the key
 *   until a write fails for quota — which would lose the draft being typed instead.
 *
 * @pattern Memento — the form's state, captured and restored by the editor, opaque to everyone else · Repository over
 *     the key/value Port, its read-modify-writes serialized by `createSerialQueue`
 */
import { z } from 'zod';

import {
    ingredientVariantSchema,
    lineResolutionStatusSchema,
    recipeDifficultySchema,
    recipeMealTypeSchema,
    recipeVisibilitySchema,
    unresolvedFoodReasonSchema,
} from '@kitchensink/recipe-core';
import { rebindIngredientLineRequestSchema } from '@kitchensink/schema-recipe';
import { appendToQuarantine, createSerialQueue, type OutboxStore } from '@kitchensink/sync';

import { isIngredientLineKey, type IngredientLineKey } from '../form/lineKey.js';
import type { RecipeFormValues } from '../form/values.js';
import type { PendingRebind } from '../hooks/lineCommit.js';

/** The format this release writes. Hand-bumped: a bump is a decision, recorded in ADR-0057. */
export const DRAFT_FORMAT_VERSION = 1;

/** The most drafts kept per user on one device. */
export const MAX_KEPT_DRAFTS = 20;

/**
 * The key holding a user's drafts.
 *
 * @param subject - The IdP subject (the app-user ULID does not exist before the first online request).
 * @returns The namespaced, versioned key. Pure.
 */
export function draftStoreKeyFor(subject: string): string {
    return `editor.draft.v${String(DRAFT_FORMAT_VERSION)}.${subject}`;
}

/**
 * The key holding a user's unreadable draft bytes: a list of raw strings, oldest first.
 *
 * @param subject - The IdP subject.
 * @returns The namespaced quarantine key. Pure.
 */
export function draftQuarantineKeyFor(subject: string): string {
    return `editor.draft.quarantine.${subject}`;
}

/** The form's values as the draft keeps them: everything but the photo picks, whose bytes are not in the form. */
export type DraftValues = Omit<RecipeFormValues, 'photos'>;

/** One recipe's device draft. */
export interface DraftMemento {
    /** The recipe: its local ref (`local:recipe:…`) before the server create, its server id after. */
    readonly recipeRef: string;
    /** The server version the draft was edited from; `null` before the server create. */
    readonly baseVersion: number | null;
    readonly values: DraftValues;
    /** The food re-picks on a published recipe that wait for Save changes (`PendingRebind`, blueprint A3). */
    readonly pendingRebinds: readonly PendingRebind[];
    /** When the draft was written, ISO 8601. */
    readonly savedAt: string;
}

const lineKeySchema = z.custom<IngredientLineKey>(
    (value) => typeof value === 'string' && isIngredientLineKey(value),
    'not a line key this editor minted',
);

const rebindTargetSchema = rebindIngredientLineRequestSchema.shape.target;

/**
 * A draft amount: a number, or JSON's `null` for the `NaN` the draft spells "no amount" with (`toRecipeFormValues`, and a
 * fresh pick, F5). `JSON.stringify` writes `NaN` as `null`, so the format reads `null` back as `NaN` — the stored bytes
 * and the form agree on one spelling each, and an amount-less line is not mistaken for an unreadable draft.
 */
const draftAmountSchema = z.union([z.number(), z.null().transform(() => Number.NaN)]);

const draftIngredientSchema = z
    .strictObject({
        key: lineKeySchema,
        ingredientId: z.string().nullable(),
        name: z.string().optional(),
        isUserEntered: z.boolean(),
        quantity: draftAmountSchema,
        quantityHigh: draftAmountSchema.optional(),
        unit: z.string().optional(),
        notes: z.string().optional(),
        preparation: z.string().optional(),
        groupLabel: z.string().optional(),
        // ⚠️ The LINE vocabulary, not the catalog one: a line read as `NEEDS_REVIEW` or `FOOD_UNREACHABLE` is a normal
        // draft, and the five-member catalog enum would quarantine it.
        resolutionStatus: lineResolutionStatusSchema.optional(),
        unresolvedReason: unresolvedFoodReasonSchema.optional(),
        foodId: z.string().optional(),
        variant: ingredientVariantSchema.optional(),
        userCalories: z.number().optional(),
        userProteinG: z.number().optional(),
        userCarbsG: z.number().optional(),
        userFatG: z.number().optional(),
        // Blueprint A5: a line pasted before the server create keeps what it was read from until the create sends it.
        sourceLine: z.string().optional(),
        sourcePhrase: z.string().optional(),
    })
    .readonly();

/**
 * The form values a draft may hold. Exported so a test can pin, at compile time, that it parses exactly
 * {@link DraftValues} — a field added to the form and not here then fails `tsc` instead of vanishing on reload.
 */
export const draftValuesSchema = z
    .strictObject({
        title: z.string(),
        description: z.string(),
        cuisine: z.string(),
        difficulty: recipeDifficultySchema.optional(),
        mealType: recipeMealTypeSchema.optional(),
        tags: z.array(z.string()).readonly(),
        dietaryFlags: z.array(z.string()).readonly(),
        servings: z.number(),
        prepTimeMinutes: z.number(),
        cookTimeMinutes: z.number(),
        visibility: recipeVisibilitySchema,
        ingredients: z.array(draftIngredientSchema).readonly(),
        steps: z
            .array(z.strictObject({ instruction: z.string(), timerSeconds: z.number().optional() }).readonly())
            .readonly(),
    })
    .readonly();

const mementoSchema = z.strictObject({
    recipeRef: z.string().min(1),
    baseVersion: z.number().int().positive().nullable(),
    values: draftValuesSchema,
    pendingRebinds: z.array(z.strictObject({ lineKey: lineKeySchema, target: rebindTargetSchema })).readonly(),
    savedAt: z.iso.datetime(),
}) satisfies z.ZodType<DraftMemento>;

const envelopeSchema = z.strictObject({
    formatVersion: z.literal(DRAFT_FORMAT_VERSION),
    drafts: z.record(z.string(), mementoSchema),
});

type Drafts = Readonly<Record<string, DraftMemento>>;

/**
 * The form's values as a draft keeps them.
 *
 * @param values - The editor's values.
 * @returns The same values without the photo picks. Pure.
 */
export function toDraftValues(values: RecipeFormValues): DraftValues {
    const { photos: _photos, ...kept } = values;

    return kept;
}

/** What a server write answered, as the draft records it. */
export interface DraftAnswer {
    /** The recipe's server id. */
    readonly serverId: string;
    /** The version the write produced: the next update's `expectedVersion`. */
    readonly version: number;
}

/** One user's drafts on one device. */
export interface DraftStore {
    /** The draft for a recipe, or `undefined` when there is none or it could not be read. */
    readonly load: (recipeRef: string) => Promise<DraftMemento | undefined>;
    /** Write a draft, replacing the recipe's previous one. Rejects when the store cannot write. */
    readonly save: (memento: DraftMemento) => Promise<void>;
    /** Remove a recipe's draft. */
    readonly discard: (recipeRef: string) => Promise<void>;
    /**
     * Record a server write's answer: a create moves the draft from its local ref to the server id, and every answer
     * raises `baseVersion` to the version it returned — never lowers it, so a late answer for an older write cannot
     * regress the token. An answer for a recipe with no draft writes nothing. The editor calls it while open; an
     * observer of the outbox calls it once the editor has closed (`useDraftAnswers`).
     */
    readonly adopt: (recipeRef: string, answer: DraftAnswer) => Promise<void>;
    /** Remove every draft and the quarantine — the session-end clear (ADR-0054). */
    readonly clear: () => Promise<void>;
}

/** One store per port and user, so every caller shares one serial queue over the key. */
const stores = new WeakMap<OutboxStore, Map<string, DraftStore>>();

/**
 * The ONE draft store for a user on a port — the editor and the outbox observer must share it, or two serial queues
 * would interleave their read-modify-writes over one key and lose a write.
 *
 * @param store - The platform adapter.
 * @param subject - The IdP subject.
 * @returns The memoized store. @sideEffect Records it for the next caller.
 */
export function draftStoreFor(store: OutboxStore, subject: string): DraftStore {
    const bySubject = stores.get(store) ?? new Map<string, DraftStore>();
    const existing = bySubject.get(subject);

    if (existing !== undefined) {
        return existing;
    }

    const created = createDraftStore(store, subject);
    bySubject.set(subject, created);
    stores.set(store, bySubject);

    return created;
}

/**
 * The draft store for one user. Prefer {@link draftStoreFor}, which shares one per port and user.
 *
 * @param store - The platform adapter.
 * @param subject - The IdP subject.
 * @returns The store. @sideEffect Its methods read and write `store`.
 */
export function createDraftStore(store: OutboxStore, subject: string): DraftStore {
    const serialized = createSerialQueue();
    const key = draftStoreKeyFor(subject);
    const quarantineKey = draftQuarantineKeyFor(subject);

    /** Read the drafts; unreadable bytes are moved to the quarantine and the key starts empty. */
    const read = async (): Promise<Drafts> => {
        const raw = await store.getItem(key);

        if (raw === null) {
            return {};
        }

        const parsed = parseDrafts(raw);

        if (parsed !== undefined) {
            return parsed;
        }

        await appendToQuarantine(store, quarantineKey, raw);
        await store.removeItem(key);

        return {};
    };

    const write = async (drafts: Drafts): Promise<void> => {
        await store.setItem(key, JSON.stringify({ formatVersion: DRAFT_FORMAT_VERSION, drafts }));
    };

    const change = (edit: (drafts: Drafts) => Drafts): Promise<void> =>
        serialized(async () => {
            await write(edit(await read()));
        });

    return {
        load: (recipeRef) => serialized(async () => (await read())[recipeRef]),
        // ⛔ Never lowers the version an answer already recorded: the editor and the outbox observer both write, and
        // whichever writes last must not regress the token.
        save: (memento) =>
            change((drafts) =>
                newest({
                    ...drafts,
                    [memento.recipeRef]: {
                        ...memento,
                        baseVersion: higherVersion(drafts[memento.recipeRef]?.baseVersion ?? null, memento.baseVersion),
                    },
                }),
            ),
        discard: (recipeRef) => change((drafts) => without(drafts, recipeRef)),
        adopt: (recipeRef, { serverId, version }) =>
            serialized(async () => {
                const drafts = await read();
                const draft = drafts[recipeRef];

                if (draft === undefined) {
                    return;
                }

                const already = drafts[serverId]?.baseVersion ?? null;

                await write({
                    ...without(drafts, recipeRef),
                    [serverId]: {
                        ...draft,
                        recipeRef: serverId,
                        baseVersion: higherVersion(higherVersion(already, draft.baseVersion), version),
                    },
                });
            }),
        clear: () =>
            serialized(async () => {
                await store.removeItem(key);
                await store.removeItem(quarantineKey);
            }),
    };
}

/** The higher of two versions, `null` meaning none. Pure. */
function higherVersion(a: number | null, b: number | null): number | null {
    if (a === null) {
        return b;
    }

    return b === null ? a : Math.max(a, b);
}

/** The drafts in a stored string, or `undefined` when it is not this format. Pure. */
function parseDrafts(raw: string): Drafts | undefined {
    try {
        const envelope = envelopeSchema.safeParse(JSON.parse(raw));

        return envelope.success ? envelope.data.drafts : undefined;
    } catch {
        return undefined;
    }
}

/** The drafts without one recipe's. Pure. */
function without(drafts: Drafts, recipeRef: string): Drafts {
    return Object.fromEntries(Object.entries(drafts).filter(([ref]) => ref !== recipeRef));
}

/** The {@link MAX_KEPT_DRAFTS} most recently saved drafts. Pure. */
function newest(drafts: Drafts): Drafts {
    const entries = Object.entries(drafts);

    if (entries.length <= MAX_KEPT_DRAFTS) {
        return drafts;
    }

    return Object.fromEntries(
        entries.sort(([, a], [, b]) => b.savedAt.localeCompare(a.savedAt)).slice(0, MAX_KEPT_DRAFTS),
    );
}
