/**
 * Analytics plan U5 — the pure search-session model (origin R1, R11; KTD5/KTD6; AE1/AE2).
 *
 * ⛔ THE KEYSTROKE TABLE IS THE LOAD-BEARING SCENARIO. The resolver debounces ~300ms, so every typing
 * pause settles a prefix ("b → bu → buck"); counting each superseded prefix as an abandonment would
 * make SC1's capture-rate denominator a function of typing cadence — one pick could emit five
 * no-picks. KTD6's rule: extension/refinement CONTINUES the session (same event id, updated query +
 * served list); an outcome emits exactly once, at pick, clear-to-empty, non-suggestion resolve, or
 * unmount. This suite drives those transitions as a table over the pure model — the hook wires them,
 * the model decides them.
 */
import { describe, expect, it } from 'vitest';
import type { IngredientSuggestion } from '@kitchensink/recipe-service-client';

import {
    abandonOutcome,
    digestSuggestions,
    observeServedList,
    pickOutcome,
    type SearchSession,
} from '../queryOutcome.model.js';

let minted = 0;

/** Deterministic id source — the model takes minting as a parameter so tests can count and compare. */
function mintId(): string {
    minted += 1;

    return `00000000-0000-4000-8000-00000000${String(minted).padStart(4, '0')}`;
}

function localSuggestion(name: string): IngredientSuggestion {
    return {
        provenance: 'local',
        ingredient: { id: `ing-${name}`, name, isUserEntered: false } as never,
    } as IngredientSuggestion;
}

function catalogSuggestion(name: string, foodId: string): IngredientSuggestion {
    return { provenance: 'catalog', foodId, name, score: 1 } as IngredientSuggestion;
}

const TWO_SECTION_LIST: IngredientSuggestion[] = [
    localSuggestion('Salt'),
    localSuggestion('Salted butter'),
    catalogSuggestion('Salt, table', 'food-salt-1'),
    catalogSuggestion('Salt, sea', 'food-salt-2'),
];

describe('observeServedList (KTD6 — begin/continue)', () => {
    it('begins a session when a non-empty list settles, and an empty list begins NOTHING', () => {
        expect(observeServedList(null, 'salt', [], mintId)).toBeNull();

        const session = observeServedList(null, 'salt', TWO_SECTION_LIST, mintId);

        expect(session).not.toBeNull();
        expect(session?.query).toBe('salt');
        expect(session?.served).toHaveLength(4);
    });

    it('CONTINUES the session on refinement — same event id, updated query and list', () => {
        const first = observeServedList(null, 'sal', TWO_SECTION_LIST, mintId);
        const second = observeServedList(first, 'salt', TWO_SECTION_LIST.slice(0, 2), mintId);

        expect(second?.eventId).toBe(first?.eventId);
        expect(second?.query).toBe('salt');
        expect(second?.served).toHaveLength(2);
    });
});

describe('pickOutcome (AE1)', () => {
    it('a pick on the first CATALOG row of a two-section list → group catalog, position-in-group 1', () => {
        const session = observeServedList(null, 'salt', TWO_SECTION_LIST, mintId);
        const event = pickOutcome(session, TWO_SECTION_LIST[2] as IngredientSuggestion);

        expect(event).not.toBeNull();
        expect(event?.query).toBe('salt');
        expect(event?.outcome).toEqual({
            kind: 'pick',
            group: 'catalog',
            positionInGroup: 1,
            foodId: 'food-salt-1',
        });
        expect(event?.served).toHaveLength(4);
    });

    it('a pick on the second LOCAL row → group local, position-in-group 2', () => {
        const session = observeServedList(null, 'salt', TWO_SECTION_LIST, mintId);
        const event = pickOutcome(session, TWO_SECTION_LIST[1] as IngredientSuggestion);

        expect(event?.outcome).toMatchObject({ kind: 'pick', group: 'local', positionInGroup: 2 });
    });

    it('answers null with no session, and null for a suggestion NOT in the served list', () => {
        expect(pickOutcome(null, TWO_SECTION_LIST[0] as IngredientSuggestion)).toBeNull();

        const session = observeServedList(null, 'salt', TWO_SECTION_LIST.slice(0, 2), mintId);
        expect(pickOutcome(session, catalogSuggestion('Ghost', 'food-ghost'))).toBeNull();
    });
});

describe('abandonOutcome (AE2)', () => {
    it('emits ONE no-pick carrying the FINAL settled query and served list', () => {
        const first = observeServedList(null, 'buck', TWO_SECTION_LIST, mintId);
        const final = observeServedList(first, 'buckwheat honey', TWO_SECTION_LIST.slice(0, 1), mintId);
        const event = abandonOutcome(final);

        expect(event?.query).toBe('buckwheat honey');
        expect(event?.served).toHaveLength(1);
        expect(event?.outcome).toEqual({ kind: 'no_pick' });
    });

    it('answers null with no session — nothing settled, nothing to abandon', () => {
        expect(abandonOutcome(null)).toBeNull();
    });
});

describe('⛔ the keystroke table (KTD6): "b → bu (pause) → buck (pause) → pick" is ONE event, zero no-picks', () => {
    it('holds', () => {
        const emitted: string[] = [];
        let session: SearchSession | null = null;

        // "b" — below the search minimum: no served list ever settles, nothing happens.
        // "bu" settles a list → session begins.
        session = observeServedList(session, 'bu', TWO_SECTION_LIST, mintId);
        // "buck" settles a refined list → session CONTINUES (no abandonment of the "bu" prefix).
        session = observeServedList(session, 'buck', TWO_SECTION_LIST.slice(0, 3), mintId);
        // The pick.
        const pick = pickOutcome(session, TWO_SECTION_LIST[2] as IngredientSuggestion);

        if (pick !== null) {
            emitted.push(pick.outcome.kind);
        }

        session = null;
        // Unmount cleanup after the pick finds NO session — no trailing no-pick.
        const trailing = abandonOutcome(session);

        if (trailing !== null) {
            emitted.push(trailing.outcome.kind);
        }

        expect(emitted).toEqual(['pick']);
    });
});

describe('id minting (KTD5)', () => {
    it('the event id is STABLE across the session — a retry of the same logical event reuses it', () => {
        const session = observeServedList(null, 'salt', TWO_SECTION_LIST, mintId);
        const continued = observeServedList(session, 'salted', TWO_SECTION_LIST, mintId);
        const event = pickOutcome(continued, TWO_SECTION_LIST[0] as IngredientSuggestion);

        expect(event?.eventId).toBe(session?.eventId);
    });

    it('two DIFFERENT logical events mint DIFFERENT ids', () => {
        const first = observeServedList(null, 'salt', TWO_SECTION_LIST, mintId);
        const second = observeServedList(null, 'thyme', TWO_SECTION_LIST, mintId);

        expect(first?.eventId).not.toBe(second?.eventId);
    });
});

describe('digestSuggestions (KTD4b)', () => {
    it('digests to group + bounded label (+ foodId for catalog), capped at the served-list bound', () => {
        const many = Array.from({ length: 30 }, (_unused, index) =>
            catalogSuggestion(`${'A very long ingredient label '.repeat(5)}${index}`, `food-${index}`),
        );
        const digest = digestSuggestions(many);

        expect(digest.length).toBeLessThanOrEqual(20);

        for (const entry of digest) {
            expect(entry.label.length).toBeLessThanOrEqual(80);
            expect(entry.group).toBe('catalog');
        }
    });
});
