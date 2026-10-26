/**
 * THE client rule for "Private" on a RECIPE (ADR-0073; owner ruling 2026-10-26): a free cook keeps up to the server's
 * limit of recipes private, in slots; Premium has no limit; only an imported public-web recipe still needs Premium.
 *
 * Written before `recipePrivateGate.ts`. Collections keep `privateGate.ts` unchanged (their own tests pin it), so nothing
 * here may be read as a rule for a collection.
 *
 * The cases are the rule's whole truth table: two rules (slots, premium) x the standing (unknown, unlimited, open, full)
 * x the paid-feature state, for the five questions a surface asks.
 */
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    privateRuleOf,
    recipeMakePublicConsequence,
    recipeOffersPrivate,
    recipePrivateChoice,
    recipePrivateRefusalOf,
    showsRecipePremiumBadge,
    slotStandingOf,
    type RecipePrivateFacts,
} from '../recipePrivateGate.js';

const { PUBLIC, PRIVATE } = RecipeVisibility;
const STATES = ['loading', 'granted', 'upsell', 'hidden'] as const;

const OPEN = { kind: 'open', used: 49, limit: 50, left: 1 } as const;
const FULL = { kind: 'full', used: 50, limit: 50 } as const;
const OVER = { kind: 'full', used: 60, limit: 50 } as const;
const UNKNOWN = { kind: 'unknown' } as const;
const LOADING = { kind: 'loading' } as const;
const UNLIMITED = { kind: 'unlimited' } as const;

const slots = (standing: RecipePrivateFacts['standing'], state: RecipePrivateFacts['state'] = 'hidden') =>
    ({ rule: 'slots', standing, state }) as const satisfies RecipePrivateFacts;
const premium = (state: RecipePrivateFacts['state']) =>
    ({ rule: 'premium', standing: UNKNOWN, state }) as const satisfies RecipePrivateFacts;

describe('slotStandingOf - the server states the number, the client never does', () => {
    it('is unknown when the read FAILED: the client does not guess a count', () => {
        expect(slotStandingOf(undefined, false)).toEqual({ kind: 'unknown' });
    });

    it('is loading while the read is in flight, so the field can say it is checking', () => {
        expect(slotStandingOf(undefined, true)).toEqual({ kind: 'loading' });
    });

    it('an answer wins over the pending flag (a refetch keeps showing the last answer)', () => {
        expect(slotStandingOf({ kind: 'unlimited' }, true)).toEqual({ kind: 'unlimited' });
    });

    it('is unlimited for Premium, carrying no count', () => {
        expect(slotStandingOf({ kind: 'unlimited' })).toEqual({ kind: 'unlimited' });
    });

    it.each([
        [0, 'open', 50],
        [48, 'open', 2],
        [49, 'open', 1],
    ])('a cook holding %i of 50 is %s with %i left', (used, kind, left) => {
        expect(slotStandingOf({ kind: 'limited', used, limit: 50 })).toEqual({ kind, used, limit: 50, left });
    });

    it.each([50, 51, 60])('a cook holding %i of 50 is full (a downgraded cook keeps their count)', (used) => {
        expect(slotStandingOf({ kind: 'limited', used, limit: 50 })).toEqual({ kind: 'full', used, limit: 50 });
    });

    it('takes the limit from the server, not from a constant: 3 of 3 is full', () => {
        expect(slotStandingOf({ kind: 'limited', used: 3, limit: 3 })).toEqual({ kind: 'full', used: 3, limit: 3 });
        expect(slotStandingOf({ kind: 'limited', used: 2, limit: 3 })).toEqual({
            kind: 'open',
            used: 2,
            limit: 3,
            left: 1,
        });
    });
});

describe('privateRuleOf - which rule a recipe is under', () => {
    it('imported public-web recipes still need Premium (and a substantive edit, which the server judges)', () => {
        expect(privateRuleOf(RecipeSourceType.IMPORTED_PUBLIC)).toBe('premium');
    });

    it.each([RecipeSourceType.USER_CREATED, RecipeSourceType.IMPORTED_PHYSICAL, RecipeSourceType.IMPORTED_PAID])(
        '%s uses a slot',
        (sourceType) => {
            expect(privateRuleOf(sourceType)).toBe('slots');
        },
    );

    it('a recipe never saved is a user_created one: slots', () => {
        expect(privateRuleOf(undefined)).toBe('slots');
    });
});

describe('recipeOffersPrivate', () => {
    it.each(STATES.map((state) => [state]))(
        'under the slots rule Private is ALWAYS offered, paid features or not (%s)',
        (state) => {
            expect(recipeOffersPrivate(slots(OPEN, state), PUBLIC)).toBe(true);
            expect(recipeOffersPrivate(slots(FULL, state), PUBLIC)).toBe(true);
            expect(recipeOffersPrivate(slots(UNKNOWN, state), PUBLIC)).toBe(true);
            expect(recipeOffersPrivate(slots(LOADING, state), PUBLIC)).toBe(true);
        },
    );

    it.each([
        ['loading', false],
        ['granted', true],
        ['upsell', true],
        ['hidden', false],
    ] as const)('under the premium rule, for a public recipe, %s -> %s', (state, expected) => {
        expect(recipeOffersPrivate(premium(state), PUBLIC)).toBe(expected);
    });

    it('a recipe that is already private always shows so', () => {
        for (const state of STATES) {
            expect(recipeOffersPrivate(premium(state), PRIVATE)).toBe(true);
        }
    });
});

describe('recipePrivateChoice - what choosing a visibility does', () => {
    it('Public always applies', () => {
        for (const facts of [slots(OPEN), slots(FULL), premium('hidden'), premium('upsell')]) {
            expect(recipePrivateChoice(facts, PRIVATE, PUBLIC)).toBe('apply');
            expect(recipePrivateChoice(facts, PUBLIC, PUBLIC)).toBe('apply');
        }
    });

    it.each([
        ['open', OPEN, 'apply'],
        ['unlimited (Premium)', UNLIMITED, 'apply'],
        ['unknown (the read failed): the server decides', UNKNOWN, 'apply'],
        ['loading: the server decides', LOADING, 'apply'],
        ['full', FULL, 'slotsFull'],
        ['over the limit after a downgrade', OVER, 'slotsFull'],
    ] as const)('Private from public under the slots rule, standing %s -> %s', (_label, standing, expected) => {
        expect(recipePrivateChoice(slots(standing), PUBLIC, PRIVATE)).toBe(expected);
    });

    it('going back to a Private the recipe already holds applies even when every slot is used (it holds its own)', () => {
        expect(recipePrivateChoice(slots(FULL), PRIVATE, PRIVATE)).toBe('apply');
        expect(recipePrivateChoice(slots(OVER), PRIVATE, PRIVATE)).toBe('apply');
    });

    it.each([
        ['granted', 'apply'],
        ['upsell', 'upsell'],
        ['hidden', 'none'],
        ['loading', 'none'],
    ] as const)('Private from public under the premium rule, %s -> %s', (state, expected) => {
        expect(recipePrivateChoice(premium(state), PUBLIC, PRIVATE)).toBe(expected);
    });

    it('the paid-feature state plays no part under the slots rule', () => {
        for (const state of STATES) {
            expect(recipePrivateChoice(slots(OPEN, state), PUBLIC, PRIVATE)).toBe('apply');
            expect(recipePrivateChoice(slots(FULL, state), PUBLIC, PRIVATE)).toBe('slotsFull');
        }
    });
});

describe('recipeMakePublicConsequence - public is NEVER final (owner ruling 2026-10-26)', () => {
    it('is none for a recipe that is not private', () => {
        for (const facts of [slots(OPEN), slots(FULL), premium('upsell')]) {
            expect(recipeMakePublicConsequence(facts, PUBLIC)).toBe('none');
        }
    });

    it.each([
        ['open', OPEN],
        ['full', FULL],
        ['over', OVER],
    ] as const)('under the slots rule with standing %s, going public frees a slot', (_label, standing) => {
        expect(recipeMakePublicConsequence(slots(standing), PRIVATE)).toBe('frees');
    });

    it('says nothing for Premium (no slots to free) and nothing while the standing is unknown (it may be Premium)', () => {
        expect(recipeMakePublicConsequence(slots(UNLIMITED), PRIVATE)).toBe('none');
        expect(recipeMakePublicConsequence(slots(UNKNOWN), PRIVATE)).toBe('none');
        expect(recipeMakePublicConsequence(slots(LOADING), PRIVATE)).toBe('none');
    });

    it('under the premium rule only the upsell has a cost to state; no state ever claims it is final or unknown', () => {
        expect(recipeMakePublicConsequence(premium('upsell'), PRIVATE)).toBe('premium');
        expect(recipeMakePublicConsequence(premium('granted'), PRIVATE)).toBe('none');
        expect(recipeMakePublicConsequence(premium('hidden'), PRIVATE)).toBe('none');
        expect(recipeMakePublicConsequence(premium('loading'), PRIVATE)).toBe('none');
    });
});

describe('recipePrivateRefusalOf - a Private the server is KNOWN to refuse', () => {
    it('under the slots rule, only a full standing refuses', () => {
        expect(recipePrivateRefusalOf(slots(FULL))).toBe('slots');
        expect(recipePrivateRefusalOf(slots(OVER))).toBe('slots');
        expect(recipePrivateRefusalOf(slots(OPEN))).toBeUndefined();
        expect(recipePrivateRefusalOf(slots(UNLIMITED))).toBeUndefined();
        expect(recipePrivateRefusalOf(slots(UNKNOWN))).toBeUndefined();
        expect(recipePrivateRefusalOf(slots(LOADING))).toBeUndefined();
    });

    it('under the premium rule it is the paid-feature refusal, as before', () => {
        expect(recipePrivateRefusalOf(premium('hidden'))).toBe('final');
        expect(recipePrivateRefusalOf(premium('upsell'))).toBe('premium');
        expect(recipePrivateRefusalOf(premium('granted'))).toBeUndefined();
        expect(recipePrivateRefusalOf(premium('loading'))).toBeUndefined();
    });
});

describe('showsRecipePremiumBadge', () => {
    it('only the premium rule under the upsell, for a recipe not already private', () => {
        expect(showsRecipePremiumBadge(premium('upsell'), PUBLIC)).toBe(true);
        expect(showsRecipePremiumBadge(premium('upsell'), PRIVATE)).toBe(false);
        expect(showsRecipePremiumBadge(premium('granted'), PUBLIC)).toBe(false);
    });

    it('never under the slots rule: Private is free within the slots', () => {
        for (const state of STATES) {
            expect(showsRecipePremiumBadge(slots(FULL, state), PUBLIC)).toBe(false);
        }
    });
});
