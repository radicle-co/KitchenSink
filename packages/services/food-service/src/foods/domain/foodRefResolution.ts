/**
 * What a caller is told about each food reference it names — the pure half of
 * `POST /api/v1/foods/refs/resolve` (curated plan U8; KTD-15). A ref names a root or a variant; a retired one is
 * answered as the entry its forward chain ends at, with `forwardedTo` naming it (ADR-0050 §4). Authorship is judged
 * on the TARGET's root, so a forward or a variant can never lend a private root's facts to a stranger.
 *
 * ## Food the seed retired with no successor still answers for itself (curated U9 P0, R29, ADR-0050 §4)
 *
 * The seed retires a root or variant it removes, and one removed with no successor has no forward. A recipe line bound
 * to it keeps its name, parts and numbers (R21, R29; owner, 2026-10-01: "Food doesn't just disappear"), and food is
 * the only place those live (ADR-0006). So such an entry — requested directly, or at the end of a chain — answers as
 * itself, as does a variant whose root the seed retired. Only CATALOG rows are ever retired, so this opens nothing to
 * a stranger: an authored root stays concealed exactly as before. Retired entries stay out of search.
 *
 * DESIGN PATTERN: **Specification** (composes `evaluateAuthorship`, the same policy `GET /{id}` applies) over a
 * pure **projection** of the reader facts onto the published {@link FoodRefEntry}. The kind of a ref is
 * dispatched by an exhaustive `switch` over its discriminant — Visitor, satisfied by the language. No SQL, no
 * HTTP, no recipe: the service reads the rows, this decides what they mean to THIS caller.
 *
 * ## ⛔ The four ways to be `absent` are ONE entry
 *
 * An unknown id, a food mid-erasure (`DELETING`), a retired entry whose chain never reaches one that answers, and
 * ANOTHER USER'S PRIVATE FOOD all produce `{ outcome: 'absent', ref: { kind, id } }`,
 * built fresh from the two fields the caller sent. Nothing about the row — not its status, not its name, not
 * even key order — can distinguish them, so the resolver cannot be used to learn that a private food exists.
 * That is the concealment `GET /{id}` gives with its 404, carried into a batch.
 *
 * ## `visibility: 'private'` reports the STORED visibility
 *
 * The authorship policy admits a private food to its author alone, so a `found` entry marked `private` means
 * "the caller authored it" — the fact recipe-service's admission policy relies on (R51). A PROMOTED food is
 * readable by everyone and therefore carries no marker for anyone; marking it would tell a stranger they own it.
 */
import { evaluateAuthorship } from './authorshipPolicy.js';
import { variantPartViewsOf } from './variantView.js';
import type { FoodRefFacts } from '../dao/food.dao.js';
import type { ForwardOutcome } from '../dao/foodForward.dao.js';
import type { VariantFacts } from '../dao/foodVariant.dao.js';
import type { FoodRef, FoodRefEntry } from '../foods.schema.js';

/**
 * What the owner reader read for a batch of refs: every root and variant a ref or a chain's end names, retired ones
 * included, and the forward outcome of every retired ref.
 */
export interface RefFacts {
    readonly roots: ReadonlyMap<string, FoodRefFacts>;
    readonly variants: ReadonlyMap<string, VariantFacts>;
    readonly forwards: ReadonlyMap<string, ForwardOutcome>;
}

/** The entry a ref resolves to, before authorship is judged. */
export interface RefTarget {
    readonly kind: 'root' | 'variant';
    readonly id: string;
    /** Whether a forward was followed to reach it. */
    readonly forwarded: boolean;
}

/** The key two refs share exactly when they name the same thing — kind AND id. Pure. */
function refKey(ref: FoodRef): string {
    return `${ref.kind}:${ref.id}`;
}

/**
 * The distinct refs, in the order each first appears.
 *
 * @param refs - The refs as the caller sent them (duplicates allowed).
 * @returns One ref per distinct `kind` + `id`. Pure.
 */
function distinctRefs(refs: readonly FoodRef[]): FoodRef[] {
    const seen = new Set<string>();
    const distinct: FoodRef[] = [];

    for (const ref of refs) {
        const key = refKey(ref);

        if (!seen.has(key)) {
            seen.add(key);
            distinct.push(ref);
        }
    }

    return distinct;
}

/**
 * The ids the reader must read first to answer `refs`: each root id and each variant id once, by kind, in
 * first-appearance order. A variant ref is read from the variant table, never as a root.
 *
 * @param refs - The refs as the caller sent them.
 * @returns The distinct ids by kind. Pure.
 */
export function refIdsToRead(refs: readonly FoodRef[]): { roots: string[]; variants: string[] } {
    const distinct = distinctRefs(refs);

    return {
        roots: distinct.filter((ref) => ref.kind === 'root').map((ref) => ref.id),
        variants: distinct.filter((ref) => ref.kind === 'variant').map((ref) => ref.id),
    };
}

/**
 * The one concealed answer. Built from `kind` and `id` alone, so a stray property on the caller's ref — or any
 * fact about a row — cannot make two absent entries differ. Pure.
 */
function absent(ref: FoodRef): FoodRefEntry {
    return { outcome: 'absent', ref: { kind: ref.kind, id: ref.id } };
}

/**
 * Where a ref's chain ends: itself when live, else its forward's end. An entry retired with NO successor (the forward
 * reader answers it with `hops: 0`) ends at itself (R29). The resolver and the nutrition batch both read through it,
 * so "where does this id go" has one answer. Whether the end ANSWERS is {@link answeringEntryOf}'s question. Pure.
 *
 * @param ref - The ref.
 * @param facts - The reader's facts.
 * @returns The target, or `undefined` for an unknown id, or a retired ref whose chain is broken or was not followed.
 */
export function refTargetOf(ref: FoodRef, facts: RefFacts): RefTarget | undefined {
    const retired = ref.kind === 'root' ? facts.roots.get(ref.id)?.retired : facts.variants.get(ref.id)?.retired;

    if (retired === undefined) {
        return undefined;
    }

    if (!retired) {
        return { kind: ref.kind, id: ref.id, forwarded: false };
    }

    const end = facts.forwards.get(ref.id);

    if (end === undefined || !end.resolved) {
        return undefined;
    }

    if (end.hops === 0) {
        return { kind: ref.kind, id: ref.id, forwarded: false };
    }

    return { kind: end.kind ?? ref.kind, id: end.id, forwarded: true };
}

/** A root that can answer: any status but `DELETING`. */
export type AnsweringRoot = FoodRefFacts & { readonly status: Exclude<FoodRefFacts['status'], 'DELETING'> };

/** The rows a target is answered from: its root, and the variant when the target is one. */
export interface AnsweringEntry {
    readonly root: AnsweringRoot;
    readonly variant: VariantFacts | undefined;
}

/** Whether a root can answer: a root mid-erasure answers nothing. Pure. */
function canAnswer(root: FoodRefFacts | undefined): root is AnsweringRoot {
    return root !== undefined && root.status !== 'DELETING';
}

/**
 * Whether a chain's end answers, and from which rows: its root and, for a variant, the variant. A live entry answers;
 * so does one the seed retired, or one whose root the seed retired, when that root is a CATALOG root (R29; owner,
 * 2026-10-01). A root mid-erasure answers nothing. The ONE predicate the resolver and the nutrition batch apply at a
 * chain's end; authorship is the caller's own question. Pure.
 *
 * @param target - The chain's end ({@link refTargetOf}).
 * @param facts - The reader's facts.
 * @returns The rows, or `undefined` when the end answers nothing.
 */
export function answeringEntryOf(target: RefTarget, facts: RefFacts): AnsweringEntry | undefined {
    const variant = target.kind === 'variant' ? facts.variants.get(target.id) : undefined;

    if (target.kind === 'variant' && variant === undefined) {
        return undefined;
    }

    const root = facts.roots.get(variant?.rootId ?? target.id);

    if (!canAnswer(root)) {
        return undefined;
    }

    if ((root.retired || variant?.retired === true) && root.userId !== null) {
        return undefined;
    }

    return { root, variant };
}

/**
 * The answer for one ref: its target's root, judged by the authorship policy. Pure.
 *
 * @param ref - The ref.
 * @param facts - The reader's facts.
 * @param callerId - The verified caller's requester key (a user ULID or a `svc_*` id).
 * @returns `found` when the caller may read the target's root, otherwise the concealed `absent`.
 */
function entryFor(ref: FoodRef, facts: RefFacts, callerId: string): FoodRefEntry {
    const target = refTargetOf(ref, facts);
    const entry = target === undefined ? undefined : answeringEntryOf(target, facts);

    if (target === undefined || entry === undefined) {
        return absent(ref);
    }

    const { root, variant } = entry;
    const verdict = evaluateAuthorship({
        callerId,
        food: { userId: root.userId, visibility: root.visibility },
        action: 'read',
    });

    if (verdict.kind !== 'allowed') {
        return absent(ref);
    }

    return {
        outcome: 'found',
        ref: { kind: ref.kind, id: ref.id },
        name: root.name,
        status: root.status,
        ...(root.visibility === 'private' ? { visibility: 'private' as const } : {}),
        ...(variant === undefined ? {} : { variant: { rootId: root.id, parts: variantPartViewsOf(variant.parts) } }),
        ...(target.forwarded ? { forwardedTo: { kind: target.kind, id: target.id } } : {}),
    };
}

/**
 * Answer every distinct ref, in the order each first appears.
 *
 * @param refs - The refs as the caller sent them (duplicates allowed).
 * @param facts - What the owner reader read for them. An id with no row is simply missing.
 * @param callerId - The verified caller's requester key; a `svc_*` principal authored nothing.
 * @returns One entry per distinct ref. Pure.
 */
export function resolveFoodRefs(refs: readonly FoodRef[], facts: RefFacts, callerId: string): FoodRefEntry[] {
    return distinctRefs(refs).map((ref): FoodRefEntry => {
        switch (ref.kind) {
            case 'root':
            case 'variant':
                return entryFor(ref, facts, callerId);

            default: {
                const unhandled: never = ref.kind;

                throw new Error(`unhandled food ref kind '${String(unhandled)}'`);
            }
        }
    });
}
