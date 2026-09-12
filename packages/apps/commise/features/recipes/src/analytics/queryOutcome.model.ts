/**
 * Analytics plan U5 — the PURE search-session model (origin R1, R11; KTD5/KTD6; AE1/AE2).
 *
 * All the judgment lives here, table-testable; the hook wires transitions and the emitter is dumb
 * transport. The unit of observation is a SEARCH SESSION, not a settled render (KTD6): the resolver
 * debounces ~300ms so every typing pause settles a prefix, and counting each superseded prefix as an
 * abandonment would make the capture-rate denominator a function of typing cadence. So:
 *
 *  - a session BEGINS when a non-empty suggestion list settles (an empty list begins nothing);
 *  - extension/refinement — either settled text starting with the other, i.e. typing more or
 *    backspacing — CONTINUES it: same event id, updated query + served list;
 *  - a WHOLESALE RETYPE is an ABANDONMENT of the first phrasing (owner ruling 2026-09-01, REVIEW F2):
 *    the open session settles as a no-pick carrying ITS query + served list, and the replacement
 *    begins a NEW session with a new id — two logical search intents, two events;
 *  - it otherwise ENDS exactly once, as a pick ({@link pickOutcome}) or a no-pick
 *    ({@link abandonOutcome} — on clear-to-empty, a non-suggestion resolution including
 *    create-after-search, or unmount cleanup), carrying the FINAL settled query and served list.
 *
 * The event id is minted when the session begins — the "logical event occurs" moment (KTD5) — and is
 * reused across continuation and any transport retry, so the ingest door's dedup can collapse
 * replays. Minting is a PARAMETER (`mintId`) so the model stays pure and tests count/compare ids.
 *
 * ⚠️ THE WIRE'S `local` GROUP CHANGES MEANING WITH PLAN 002 S5. Before it, `local` was recipe's
 * "already used in a recipe" section of the blended suggest, which held any cook's shared bindings.
 * From S5 the list's first group is the cook's OWN authored foods (`docs/design/rowEditorOpenDecisions.md`,
 * S5 list contract L1 and L2), and it is digested as `local`: the enum did not change, so an analysis
 * that reads `local` across that release compares two different populations.
 *
 * ⚠️ The digest is the DATABASE part only (plan 002 S7.8). The wire has no group for a remote source's foods, so a
 * remote food is never served in the digest, and a remote pick is recorded as no pick. Counting remote picks needs a
 * wire change (`@kitchensink/recipe-core/analytics/event-payload`), not a change here.
 */
import {
    MAX_SERVED_LIST_ENTRIES,
    MAX_SUGGESTION_LABEL_LENGTH,
    type QueryOutcomeEvent,
    type ServedSuggestionDigest,
} from '@kitchensink/recipe-core/analytics/event-payload';

import type { FoodOption } from '../hooks/foodSuggestions.model.js';

/** One open search session: what was asked, what was served, and the event's pre-minted identity. */
export interface SearchSession {
    readonly eventId: string;
    readonly query: string;
    readonly served: readonly ServedSuggestionDigest[];
}

/** Digest ONE served food to its wire shape (bounded label; foodId only for a catalog food). */
function digestOne(food: FoodOption): ServedSuggestionDigest {
    const label = food.hit.name.slice(0, MAX_SUGGESTION_LABEL_LENGTH);

    return food.group === 'authored' ? { group: 'local', label } : { group: 'catalog', label, foodId: food.hit.id };
}

/**
 * Digest a served suggestion list for the wire (KTD4b): group + bounded label (+ foodId), capped at
 * the served-list bound so the largest legal list stays inside the keepalive arithmetic.
 */
export function digestSuggestions(foods: readonly FoodOption[]): ServedSuggestionDigest[] {
    return foods.slice(0, MAX_SERVED_LIST_ENTRIES).map(digestOne);
}

/**
 * Whether `next` refines `previous` (or vice versa): one settled text starts with the other, which is
 * what typing more — or backspacing — looks like across debounce settles. Case-insensitive, because
 * retyping a word with different casing is not a new search intent.
 */
function isRefinement(previous: string, next: string): boolean {
    const a = previous.toLowerCase();
    const b = next.toLowerCase();

    return a.startsWith(b) || b.startsWith(a);
}

/** What one served-list settle produced: the session to hold, and any abandonment to emit. */
export interface ObservedServedList {
    readonly session: SearchSession | null;
    /** The OLD session's no-pick, when the new text was a wholesale retype (owner ruling, REVIEW F2). */
    readonly abandoned: QueryOutcomeEvent | null;
}

/**
 * A served list settled for `query`: begin a session (non-empty list, none open), CONTINUE the open
 * one (extension/refinement — same event id, updated query and served list), or REPLACE it (a
 * wholesale retype abandons the open session as a no-pick and begins a new one with a new id). An
 * empty list begins nothing — but a retype that settles empty still abandons the old session.
 *
 * @param session - The open session, or `null`.
 * @param query - The settled (debounced, trimmed) query the list answers.
 * @param foods - The foods the list served, in the order it showed them.
 * @param mintId - The id source (a UUID minter in production; deterministic in tests).
 * @returns The session to hold, plus the abandoned old session's no-pick when the text was replaced.
 */
export function observeServedList(
    session: SearchSession | null,
    query: string,
    foods: readonly FoodOption[],
    mintId: () => string,
): ObservedServedList {
    const continues = session !== null && isRefinement(session.query, query);
    const abandoned = session !== null && !continues ? abandonOutcome(session) : null;

    if (foods.length === 0 && !continues) {
        return { session: null, abandoned };
    }

    return {
        session: {
            eventId: continues ? session.eventId : mintId(),
            query,
            served: digestSuggestions(foods),
        },
        abandoned,
    };
}

/** Build the event envelope shared by both outcomes. */
function toEvent(session: SearchSession, outcome: QueryOutcomeEvent['outcome']): QueryOutcomeEvent {
    return {
        type: 'query_outcome',
        eventId: session.eventId,
        occurredAt: new Date().toISOString(),
        query: session.query,
        served: session.served,
        outcome,
    };
}

/**
 * The session ended in a PICK (AE1). Group comes from the food's group; position is 1-based WITHIN that
 * group's section of the SERVED digest — the ranking-quality signal U15 had to reconstruct by SQL
 * archaeology.
 *
 * @returns The pick event, or `null` when there is no session or the pick cannot be located in the
 *   served digest (a stale render, or an entry truncated past the digest cap) — a position that was
 *   never served must not be asserted.
 */
export function pickOutcome(session: SearchSession | null, food: FoodOption): QueryOutcomeEvent | null {
    if (session === null) {
        return null;
    }

    const digest = digestOne(food);
    const sameGroup = session.served.filter((entry) => entry.group === digest.group);
    const index = sameGroup.findIndex((entry) =>
        digest.group === 'catalog' ? entry.foodId === digest.foodId : entry.label === digest.label,
    );

    if (index === -1) {
        return null;
    }

    return toEvent(session, {
        kind: 'pick',
        group: digest.group,
        positionInGroup: index + 1,
        ...(digest.foodId === undefined ? {} : { foodId: digest.foodId }),
    });
}

/**
 * The session ended WITHOUT a pick (AE2 — the capture-rate denominator): cleared to empty, resolved
 * through a non-suggestion route (create-after-search included), or the surface unmounted.
 *
 * @returns The no-pick event carrying the final settled query + served list, or `null` with no session.
 */
export function abandonOutcome(session: SearchSession | null): QueryOutcomeEvent | null {
    if (session === null) {
        return null;
    }

    return toEvent(session, { kind: 'no_pick' });
}
