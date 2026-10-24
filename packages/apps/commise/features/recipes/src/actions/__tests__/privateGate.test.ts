/**
 * THE client rule for "Private" (plan 2026-10-14-009 D14; owner ruling 2026-10-13; UX spec in the plan): every surface
 * that offers Private — the editor field, the recipe ⋯ menu, a collection ⋯ menu and its Undo — asks these.
 *
 * `granted` uses the paid feature; `upsell` offers Premium; `hidden` shows neither; `loading` fails closed. A thing
 * that is ALREADY private stays private and shows so, in every state: going back to what the server holds needs no
 * entitlement.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    effectiveVisibility,
    heldVisibility,
    makePublicConsequence,
    mayRestorePrivate,
    offersPrivate,
    privateChoice,
    privateNeedsPremium,
    privateRefusalOf,
    refusedDraftPrivate,
    serverRefusalOf,
    showsPremiumBadge,
} from '../privateGate.js';

const { PUBLIC, PRIVATE } = RecipeVisibility;
const STATES = ['loading', 'granted', 'upsell', 'hidden'] as const;

describe('offersPrivate', () => {
    it.each([
        ['loading', false],
        ['granted', true],
        ['upsell', true],
        ['hidden', false],
    ] as const)('for a public thing, %s → %s', (state, expected) => {
        expect(offersPrivate(state, PUBLIC)).toBe(expected);
    });

    it.each(STATES.map((state) => [state]))('always for a thing that is already private (%s)', (state) => {
        expect(offersPrivate(state, PRIVATE)).toBe(true);
    });
});

describe('privateChoice — what choosing a visibility does', () => {
    it.each(STATES.map((state) => [state]))('choosing Public always applies (%s)', (state) => {
        expect(privateChoice({ target: PUBLIC, saved: PRIVATE, state })).toBe('apply');
        expect(privateChoice({ target: PUBLIC, saved: PUBLIC, state })).toBe('apply');
    });

    it.each([
        ['granted', 'apply'],
        ['upsell', 'upsell'],
        ['hidden', 'none'],
        ['loading', 'none'],
    ] as const)('choosing Private for a public thing, %s → %s', (state, expected) => {
        expect(privateChoice({ target: PRIVATE, saved: PUBLIC, state })).toBe(expected);
    });

    it.each(STATES.map((state) => [state]))('choosing Private back for a saved-private thing applies (%s)', (state) => {
        expect(privateChoice({ target: PRIVATE, saved: PRIVATE, state })).toBe('apply');
    });
});

describe('privateNeedsPremium', () => {
    it('is true ONLY for upsell, choosing Private for a public thing', () => {
        for (const state of STATES) {
            for (const saved of [PUBLIC, PRIVATE]) {
                for (const target of [PUBLIC, PRIVATE]) {
                    const expected = state === 'upsell' && saved === PUBLIC && target === PRIVATE;

                    expect(privateNeedsPremium({ target, saved, state }), `${state} ${saved}→${target}`).toBe(expected);
                }
            }
        }
    });
});

describe('showsPremiumBadge', () => {
    it('is shown only under upsell, and never on a thing already private', () => {
        expect(showsPremiumBadge('upsell', PUBLIC)).toBe(true);
        expect(showsPremiumBadge('upsell', PRIVATE)).toBe(false);

        for (const state of ['loading', 'granted', 'hidden'] as const) {
            expect(showsPremiumBadge(state, PUBLIC), state).toBe(false);
        }
    });
});

/**
 * REPLACES `privateIsFinal` (hidden only). A downgraded owner who makes a private thing public cannot simply make it
 * private again, so that step is confirmed first (UX SPECIFY 2026-10-15), and the Public choice carries a note saying
 * so whenever the confirm can open (WCAG 3.2.2: a radio that opens a dialog must say so before it is used). One rule
 * drives the confirm, its words and the note.
 */
describe('makePublicConsequence — what making a private thing public costs the cook', () => {
    it.each([
        ['hidden', 'final'],
        ['upsell', 'premium'],
        ['loading', 'unknown'],
        ['granted', 'none'],
    ] as const)('a private thing, %s → %s', (state, expected) => {
        expect(makePublicConsequence(state, PRIVATE)).toBe(expected);
    });

    it.each(STATES.map((state) => [state]))('nothing for a thing already public (%s)', (state) => {
        expect(makePublicConsequence(state, PUBLIC)).toBe('none');
    });
});

/**
 * A draft kept from before the cook lost the paid features can still say Private for a recipe the server does not hold
 * private. The server will refuse it, so the field shows Public and says why, and nothing private is sent.
 */
/**
 * REWRITTEN after the review (B1): the refusal is a KNOWN one (`privateRefusalOf` over the profile's own answer), never
 * the display state, in which a failed profile read is `hidden`. One answer feeds the field, the preview and the create.
 */
describe('refusedDraftPrivate / effectiveVisibility — a draft Private the server will refuse', () => {
    it.each(['final', 'premium'] as const)('a private draft of a recipe not held private, under %s', (refusal) => {
        expect(refusedDraftPrivate(refusal, PUBLIC, PRIVATE)).toBe(refusal);
        expect(effectiveVisibility(refusal, PUBLIC, PRIVATE)).toBe(PUBLIC);
    });

    it('⛔ with no KNOWN refusal, the draft`s Private stands', () => {
        expect(refusedDraftPrivate(undefined, PUBLIC, PRIVATE)).toBeUndefined();
        expect(effectiveVisibility(undefined, PUBLIC, PRIVATE)).toBe(PRIVATE);
    });

    it.each([undefined, 'final', 'premium'] as const)(
        'never for a recipe held private, or a public draft (%s)',
        (refusal) => {
            expect(refusedDraftPrivate(refusal, PRIVATE, PRIVATE)).toBeUndefined();
            expect(refusedDraftPrivate(refusal, PUBLIC, PUBLIC)).toBeUndefined();
            expect(effectiveVisibility(refusal, PRIVATE, PRIVATE)).toBe(PRIVATE);
            expect(effectiveVisibility(refusal, PUBLIC, PUBLIC)).toBe(PUBLIC);
        },
    );
});

/**
 * The free return to Private lasts only while the draft keeps it. A downgraded owner who moves the editor's draft off
 * Private has given it up: the next Private would be a change TO private, which the server refuses without an entitled
 * role, so the gate must ask it as one (the stuck-save defect: Public, then Private again, then a refused write).
 */
describe('heldVisibility — what the editor may keep without an entitlement', () => {
    it.each([
        [PRIVATE, PRIVATE, PRIVATE],
        [PRIVATE, PUBLIC, PUBLIC],
        [PUBLIC, PRIVATE, PUBLIC],
        [PUBLIC, PUBLIC, PUBLIC],
    ] as const)('saved %s, draft %s → %s', (saved, draft, expected) => {
        expect(heldVisibility(saved, draft)).toBe(expected);
    });

    it.each([
        ['hidden', false, 'none'],
        ['upsell', true, 'upsell'],
        ['loading', false, 'none'],
        ['granted', true, 'apply'],
    ] as const)('once the draft left Private, %s: Private offered %s, choosing it → %s', (state, offered, outcome) => {
        const held = heldVisibility(PRIVATE, PUBLIC);

        expect(offersPrivate(state, held)).toBe(offered);
        expect(privateChoice({ target: PRIVATE, saved: held, state })).toBe(outcome);
    });
});

describe('mayRestorePrivate — an Undo back to private', () => {
    it.each([
        ['granted', true],
        ['upsell', false],
        ['hidden', false],
        ['loading', false],
    ] as const)('%s → %s', (state, expected) => {
        expect(mayRestorePrivate(state)).toBe(expected);
    });
});

/**
 * When the client KNOWS the server would refuse a change to private, it does not send one (the editor's create body and
 * its visibility follow-up) and says why instead. Only a settled state knows: under `loading` the write goes out and the
 * server decides, because withholding a private choice would leave the recipe public — failing open on privacy.
 */
describe('privateRefusalOf — a change to private the server is known to refuse', () => {
    it.each([
        ['hidden', 'final'],
        ['upsell', 'premium'],
        ['loading', undefined],
        ['granted', undefined],
    ] as const)('%s → %s', (state, expected) => {
        expect(privateRefusalOf(state)).toBe(expected);
    });
});

describe('serverRefusalOf — why a Private the server DID refuse was refused', () => {
    // The server has already said no, so unlike `privateRefusalOf` this always answers: what the client knows picks the
    // words (Premium would help, or nothing will), and what it does not know is told as final — a refusal that trying
    // again cannot cure.
    it.each([
        [undefined, 'final'],
        ['loading', 'final'],
        ['granted', 'final'],
        ['upsell', 'premium'],
        ['hidden', 'final'],
    ] as const)('for a profile reading of %s → %s', (known, why) => {
        expect(serverRefusalOf(known)).toBe(why);
    });
});
