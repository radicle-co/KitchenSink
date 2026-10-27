/**
 * @module @commise/features-recipes/actions - THE client rule for "Private" on a RECIPE (ADR-0073; owner ruling
 * 2026-10-26), read by the editor's visibility field and the recipe page's menu.
 *
 * A free cook keeps up to the server's limit of recipes private, in slots (every private recipe uses one, books and paid
 * sites included); Premium has no limit; an imported public-web recipe is the one kind of privacy that still needs
 * Premium (and a substantive edit, which the server judges). So a recipe is under one of two rules:
 *
 * - `slots` - Private works while a slot is free. Paid features play no part: they cannot hide Private, and they only
 *   decide whether the refusal also offers Premium.
 * - `premium` - the paid-feature rule that `privateGate.ts` states for collections, unchanged.
 *
 * ⛔ A COLLECTION IS NOT UNDER THIS MODULE. `privateGate.ts` still decides collections (their privacy is still a Premium
 * feature), and this module reuses its pieces for the `premium` rule rather than restating them.
 *
 * ⛔ THE COUNT IS A DISPLAY FACT. The server decides every private write under its own lock, so an `unknown` standing
 * (loading, or the read failed) never withholds a Private: the write goes out and the server answers. Only a KNOWN full
 * standing stops the client offering it.
 *
 * ⛔ PUBLIC IS NEVER FINAL (owner ruling 2026-10-26). Making a private recipe public frees a slot, and a free slot is
 * all it takes to make it private again, so no consequence here says "you won't be able to".
 *
 * ⛔ A DRAFT HOLDS NO SLOT (owner ruling 2026-10-26, ADR-0073 section 12). A slot is a private recipe that is PUBLISHED, so
 * a private draft is never refused for want of one - only PUBLISHING it is. That is carried in the standing, not in a flag
 * beside it: a draft's standing is {@link slotStandingForRecipe}'s `draft`, which no question below ever refuses or counts,
 * and the Publish press asks the same questions with the cook's real standing.
 *
 * @pattern Specification - pure predicates over the viewer's rule, slot standing and paid-feature state
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeSourceType, RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import type { PrivateSlotUsage } from '@kitchensink/schema-recipe';

import {
    offersPrivate,
    privateChoice,
    privateRefusalOf,
    showsPremiumBadge,
    type PrivateRefusal,
} from './privateGate.js';

/**
 * Where the cook stands on private slots, from the server's read (`GET /api/v1/recipes/private-slots`).
 *
 * `loading` is "no answer yet" and `unknown` is "the read failed": the client does not guess a count in either, and
 * neither withholds a Private (the server decides).
 */
export type SlotStanding =
    | { readonly kind: 'loading' }
    /** The recipe is a draft: it holds no slot and takes none until it is published, so there is nothing to count or refuse. */
    | { readonly kind: 'draft' }
    | { readonly kind: 'unknown' }
    | { readonly kind: 'unlimited' }
    | { readonly kind: 'open'; readonly used: number; readonly limit: number; readonly left: number }
    | { readonly kind: 'full'; readonly used: number; readonly limit: number };

/**
 * The cook's standing. Pure.
 *
 * @param usage - The server's answer, or `undefined` while it has none (loading or failed).
 * @param pending - Whether the read is in flight with no answer yet.
 * @returns `open` while `used < limit` (with the slots left), `full` otherwise - including over the limit, which a
 *   downgraded cook is and which the refusal states truthfully.
 */
export function slotStandingOf(usage: PrivateSlotUsage | undefined, pending = false): SlotStanding {
    if (usage === undefined) {
        return pending ? { kind: 'loading' } : { kind: 'unknown' };
    }

    if (usage.kind === 'unlimited') {
        return { kind: 'unlimited' };
    }

    return usage.used < usage.limit
        ? { kind: 'open', used: usage.used, limit: usage.limit, left: usage.limit - usage.used }
        : { kind: 'full', used: usage.used, limit: usage.limit };
}

/**
 * The standing a RECIPE is judged on. Pure.
 *
 * @param standing - The cook's standing ({@link slotStandingOf}).
 * @param recipe.published - Whether the recipe is published (a recipe never saved is not).
 * @param recipe.publishRefused - Whether a Publish of this draft was just refused for want of a slot: the cook's real
 *   standing is then what the editor shows, so the refusal and its ways forward can be drawn.
 * @returns The cook's standing for a published recipe or a refused Publish; `unlimited` stays `unlimited` (Premium has no
 *   slots to hold or take); otherwise `draft`.
 */
export function slotStandingForRecipe(
    standing: SlotStanding,
    recipe: { readonly published: boolean; readonly publishRefused: boolean },
): SlotStanding {
    return recipe.published || recipe.publishRefused || standing.kind === 'unlimited' ? standing : DRAFT_STANDING;
}

const DRAFT_STANDING: SlotStanding = { kind: 'draft' };

/**
 * Whether a recipe is published, which is what makes it hold a slot when it is private (ADR-0073 section 12). Pure.
 *
 * Read from the recipe's STATUS and nothing else: a published recipe sent back to draft keeps its lifecycle (every save of
 * it makes a version) but holds no slot. The one place the editor's surfaces ask it.
 *
 * @param recipe - The recipe as the editor was seeded with it; `undefined` for one never saved.
 */
export function recipeIsPublished(recipe: Pick<RecipeDetail, 'status'> | undefined): boolean {
    return recipe?.status === RecipeStatus.PUBLISHED;
}

/**
 * What a DRAFT SAVE may be refused for. Pure.
 *
 * @param refusal - Why a write that publishes a private recipe would be refused (`recipePrivateRefusalOf` over the real
 *   standing).
 * @returns The same, without the slots refusal: saving a draft takes no slot, so a Private draft is sent as chosen.
 */
export function refusalWhileDrafting(refusal: PrivateRefusal | undefined): PrivateRefusal | undefined {
    return refusal === 'slots' ? undefined : refusal;
}

/**
 * Which rule a recipe's Private is under.
 *
 * - `slots`: private within the cook's slots, and it can go public (a recipe the cook wrote).
 * - `privateOnly`: private within the cook's slots, and it can NEVER go public (a book or paid-site recipe, 004 FR-014a),
 *   so nothing may promise a way back from public; deleting it is the only way to free its slot (ADR-0073 section 4).
 * - `premium`: an imported public-web recipe, where Premium is still the rule.
 */
export type PrivateRule = 'slots' | 'privateOnly' | 'premium';

/** Whether the rule is a slot rule (counted against the cook's private slots), as opposed to Premium's. Pure. */
export function usesSlots(rule: PrivateRule): boolean {
    return rule !== 'premium';
}

/**
 * The rule for a recipe. Pure.
 *
 * @param sourceType - The recipe's label; `undefined` for one never saved (it is `user_created`).
 * @returns `premium` for an imported public-web recipe, `slots` for every other label.
 */
export function privateRuleOf(sourceType: RecipeSourceType | undefined): PrivateRule {
    switch (sourceType) {
        case RecipeSourceType.IMPORTED_PUBLIC:
            return 'premium';
        case RecipeSourceType.IMPORTED_PHYSICAL:
        case RecipeSourceType.IMPORTED_PAID:
            return 'privateOnly';
        case RecipeSourceType.USER_CREATED:
        case undefined:
            return 'slots';
    }
}

/**
 * Whether a recipe under `rule` may ever be public. Pure.
 *
 * @returns `false` only for a book or paid-site recipe (`privateOnly`, 004 FR-014a): the server refuses Public for it, so no
 *   surface offers it.
 */
export function mayBePublic(rule: PrivateRule): boolean {
    return rule !== 'privateOnly';
}

/**
 * Whether the cook holds MORE private recipes than they have slots (a downgrade). Pure. At exactly the limit they are
 * "all in use", not over it.
 */
export function isOverLimit(standing: SlotStanding): standing is Extract<SlotStanding, { kind: 'full' }> {
    return standing.kind === 'full' && standing.used > standing.limit;
}

/** What a recipe surface decides Private from. */
export interface RecipePrivateFacts {
    readonly rule: PrivateRule;
    readonly standing: SlotStanding;
    /** The viewer's paid-feature state: under `premium` it is the rule; under `slots` it only gates offering Premium. */
    readonly state: PaidFeatureState;
}

/** What choosing a visibility does on a recipe: apply it, open the Premium sheet, show the full refusal, or nothing. */
export type RecipePrivateOutcome = 'apply' | 'upsell' | 'slotsFull' | 'none';

/**
 * Whether Private is offered at all. Pure.
 *
 * @param facts - The rule, standing and paid-feature state.
 * @param saved - The visibility the server holds (or the cook may keep).
 * @returns `true` under the slots rule always; under the premium rule as `offersPrivate` decides.
 */
export function recipeOffersPrivate(facts: RecipePrivateFacts, saved: RecipeVisibility): boolean {
    return usesSlots(facts.rule) || offersPrivate(facts.state, saved);
}

/**
 * What choosing `target` does. Pure.
 *
 * @param facts - The rule, standing and paid-feature state.
 * @param saved - The visibility the server holds (or the cook may keep).
 * @param target - The visibility being chosen.
 * @returns `apply` for Public, for a Private the recipe already holds, and for Private while a slot may be free
 *   (an `unknown` standing included); `slotsFull` for Private with none left; under the premium rule as `privateChoice`.
 */
export function recipePrivateChoice(
    facts: RecipePrivateFacts,
    saved: RecipeVisibility,
    target: RecipeVisibility,
): RecipePrivateOutcome {
    if (target !== RecipeVisibility.PRIVATE || saved === RecipeVisibility.PRIVATE) {
        return 'apply';
    }

    if (usesSlots(facts.rule)) {
        return facts.standing.kind === 'full' ? 'slotsFull' : 'apply';
    }

    return privateChoice({ target, saved, state: facts.state });
}

/** What going public from private costs the cook: nothing to say, a slot freed, or (premium rule) Premium to return. */
export type RecipeMakePublicConsequence = 'none' | 'frees' | 'premium';

/**
 * What making a private recipe public says. Pure.
 *
 * @param facts - The rule, standing and paid-feature state.
 * @param saved - The visibility the cook may keep (the editor's `heldVisibility`; the server's elsewhere).
 * @returns `frees` under the slots rule for a cook with slots (it frees one, and a free slot is all it takes to come
 *   back); `premium` under the premium rule's upsell; otherwise `none`. Never a claim that public is final.
 */
export function recipeMakePublicConsequence(
    facts: RecipePrivateFacts,
    saved: RecipeVisibility,
): RecipeMakePublicConsequence {
    if (saved !== RecipeVisibility.PRIVATE) {
        return 'none';
    }

    if (facts.rule === 'premium') {
        return facts.state === 'upsell' ? 'premium' : 'none';
    }

    // A book or paid-site recipe cannot go public (the server refuses), so nothing is promised about coming back.
    if (facts.rule === 'privateOnly') {
        return 'none';
    }

    return facts.standing.kind === 'open' || facts.standing.kind === 'full' ? 'frees' : 'none';
}

/**
 * Why the server is KNOWN to refuse a change to private. Pure.
 *
 * @param facts - The rule, standing and paid-feature state (the profile's own answer, for what will be SENT).
 * @returns `slots` under the slots rule with every slot used; under the premium rule `final` or `premium` as
 *   `privateRefusalOf` decides; otherwise `undefined` (an unknown standing never refuses).
 */
export function recipePrivateRefusalOf(facts: RecipePrivateFacts): PrivateRefusal | undefined {
    if (usesSlots(facts.rule)) {
        return facts.standing.kind === 'full' ? 'slots' : undefined;
    }

    return privateRefusalOf(facts.state);
}

/**
 * Whether the Private option carries the Premium badge. Pure.
 *
 * @param facts - The rule, standing and paid-feature state.
 * @param saved - The visibility the server holds.
 * @returns `true` only under the premium rule's upsell: within the slots Private is free.
 */
export function showsRecipePremiumBadge(facts: RecipePrivateFacts, saved: RecipeVisibility): boolean {
    return facts.rule === 'premium' && showsPremiumBadge(facts.state, saved);
}
