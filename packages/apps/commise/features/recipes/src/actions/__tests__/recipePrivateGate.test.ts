/**
 * THE client rule for "Private" on a RECIPE (ADR-0073; owner ruling 2026-10-26): a free cook keeps up to the server's
 * limit of recipes private, in slots; Premium has no limit; only an imported public-web recipe still needs Premium.
 *
 * Written before `recipePrivateGate.ts`. Collections keep `privateGate.ts` unchanged (their own tests pin it), so nothing
 * here may be read as a rule for a collection.
 *
 * UPDATED for the owner ruling of 2026-10-26 (ADR-0073 section 12): a DRAFT holds no slot, so a private draft never meets
 * the out-of-slots refusal and publishing it does. The draft/published cases are the last describe blocks; the earlier ones
 * are about a recipe that is published (its standing is the server's count, unchanged).
 *
 * The cases are the rule's whole truth table: two rules (slots, premium) x the standing (unknown, unlimited, open, full)
 * x the paid-feature state, for the five questions a surface asks.
 */
import { RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    recipeIsPublished,
    refusalWhileDrafting,
    slotStandingForRecipe,
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

    it('a recipe the cook wrote uses a slot, and can go public', () => {
        expect(privateRuleOf(RecipeSourceType.USER_CREATED)).toBe('slots');
    });

    // A book or paid-site recipe uses a slot like any other (ADR-0073 section 7) but can NEVER go public (004 FR-014a), so
    // its slot is freed only by deleting it. It is its own rule so no surface promises it can be made public and private
    // again.
    it.each([RecipeSourceType.IMPORTED_PHYSICAL, RecipeSourceType.IMPORTED_PAID])(
        '%s uses a slot but can never go public: its own rule',
        (sourceType) => {
            expect(privateRuleOf(sourceType)).toBe('privateOnly');
        },
    );

    it('a recipe never saved is a user_created one: slots', () => {
        expect(privateRuleOf(undefined)).toBe('slots');
    });
});

describe('privateOnly: a book or paid-site recipe is counted exactly as a slot recipe is', () => {
    const privateOnly = (standing: RecipePrivateFacts['standing'], state: RecipePrivateFacts['state'] = 'upsell') =>
        ({ rule: 'privateOnly', standing, state }) as const satisfies RecipePrivateFacts;

    it('offers Private whatever the paid features say, and refuses it only when every slot is KNOWN used', () => {
        for (const state of STATES) {
            expect(recipeOffersPrivate(privateOnly(OPEN, state), PUBLIC)).toBe(true);
            expect(recipePrivateChoice(privateOnly(OPEN, state), PUBLIC, PRIVATE)).toBe('apply');
            expect(recipePrivateChoice(privateOnly(UNKNOWN, state), PUBLIC, PRIVATE)).toBe('apply');
            expect(recipePrivateChoice(privateOnly(FULL, state), PUBLIC, PRIVATE)).toBe('slotsFull');
        }

        expect(recipePrivateRefusalOf(privateOnly(FULL))).toBe('slots');
        expect(recipePrivateRefusalOf(privateOnly(OPEN))).toBeUndefined();
        expect(showsRecipePremiumBadge(privateOnly(FULL), PUBLIC)).toBe(false);
    });

    it('⛔ never promises a way back: it cannot go public, so going public frees nothing to promise', () => {
        for (const standing of [OPEN, FULL, OVER, UNKNOWN, LOADING, UNLIMITED]) {
            expect(recipeMakePublicConsequence(privateOnly(standing), PRIVATE)).toBe('none');
        }
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

describe('slotStandingForRecipe - a draft holds no slot (ADR-0073 section 12)', () => {
    it('a PUBLISHED recipe stands where the cook stands: the server count, unchanged', () => {
        for (const standing of [OPEN, FULL, OVER, UNKNOWN, LOADING, UNLIMITED]) {
            expect(slotStandingForRecipe(standing, { published: true })).toBe(standing);
        }
    });

    it('a DRAFT (or a recipe never saved) has no standing to count, whatever the cook holds', () => {
        for (const standing of [OPEN, FULL, OVER, UNKNOWN, LOADING]) {
            expect(slotStandingForRecipe(standing, { published: false })).toEqual({
                kind: 'draft',
            });
        }
    });

    it('⛔ Premium has no slots at all, so a draft stays `unlimited`: it never says "publishing uses a slot"', () => {
        expect(slotStandingForRecipe(UNLIMITED, { published: false })).toBe(UNLIMITED);
    });

    // REMOVED with the inline refusal (owner ruling 2026-10-26): "a draft whose Publish was refused for want of a slot
    // stands where the cook stands" served only to draw that refusal. The dialog replaces it (useRecipeEditor.test.tsx).
});

describe('a private DRAFT never meets the out-of-slots refusal; publishing it does', () => {
    const draft = (state: RecipePrivateFacts['state'] = 'hidden'): RecipePrivateFacts => ({
        rule: 'slots',
        standing: slotStandingForRecipe(FULL, { published: false }),
        state,
    });

    it('choosing Private on a draft applies, even when every slot is used', () => {
        expect(recipePrivateChoice(draft(), PUBLIC, PRIVATE)).toBe('apply');
    });

    it('no refusal is known for a draft save (it would be sent)', () => {
        expect(recipePrivateRefusalOf(draft())).toBeUndefined();
    });

    it('a private draft made public frees nothing, so no cost is stated', () => {
        expect(recipeMakePublicConsequence(draft(), PRIVATE)).toBe('none');
    });

    it('PUBLISHING it is refused with the slots refusal: the same facts, with the cook’s real standing', () => {
        const publishing: RecipePrivateFacts = { rule: 'slots', standing: FULL, state: 'hidden' };

        expect(recipePrivateRefusalOf(publishing)).toBe('slots');
        expect(recipePrivateChoice(publishing, PUBLIC, PRIVATE)).toBe('slotsFull');
    });

    it('the premium rule is not a slot rule: a draft is still refused Private for want of Premium', () => {
        expect(recipePrivateRefusalOf({ rule: 'premium', standing: { kind: 'draft' }, state: 'upsell' })).toBe(
            'premium',
        );
    });
});

describe('refusalWhileDrafting - what a draft save may be refused for', () => {
    it('drops the slots refusal (a draft takes no slot) and keeps the others', () => {
        expect(refusalWhileDrafting('slots')).toBeUndefined();
        expect(refusalWhileDrafting('final')).toBe('final');
        expect(refusalWhileDrafting('premium')).toBe('premium');
        expect(refusalWhileDrafting(undefined)).toBeUndefined();
    });
});

describe('recipeIsPublished - what makes a recipe hold a slot is its STATUS', () => {
    it('is true only for a published recipe; a draft and a recipe never saved are not', () => {
        expect(recipeIsPublished({ status: RecipeStatus.PUBLISHED })).toBe(true);
        expect(recipeIsPublished({ status: RecipeStatus.DRAFT })).toBe(false);
        expect(recipeIsPublished(undefined)).toBe(false);
    });
});
