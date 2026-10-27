'use client';

/**
 * @module @commise/features-recipes/actions — what choosing "Private" does in the recipe editor, for both hosts (E1;
 * build spec §6.4, §7.7 item 2; owner ruling 2026-10-13; plan 2026-10-14-009 D14). The decision itself is
 * {@link useGatedPrivate}, shared with the recipe page's ⋯ menu; this only supplies what applying Private means in the
 * editor — setting the draft's visibility — and what the visibility leaves render from.
 *
 * Every decision is asked with {@link heldVisibility}, never the visibility the editor opened on: once the draft leaves
 * Private, choosing it again is a change to private like any other. Leaving it is confirmed first for a downgraded
 * owner, who cannot simply come back (`useMakePublicConfirm`, UX SPECIFY 2026-10-15).
 *
 * The host picks the leaf: `offersPrivate` → `RecipeVisibilityField` (Public and Private); otherwise
 * `RecipeVisibilityStatement` (a plain "Who can see it: Public"). Never a mode prop on one leaf.
 *
 * @pattern Adapter — {@link useGatedPrivate} to the visibility leaves' props
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import type { RecipeVisibilityFieldProps, RecipeVisibilityStatementProps } from '../form/props.js';
import type { RecipeFormValues } from '../form/values.js';
import type { RecipeMakePublicDialogProps, RecipeUpsellSheetProps } from './model.js';
import { effectiveVisibility, heldVisibility } from './privateGate.js';
import {
    recipeMakePublicConsequence,
    recipePrivateRefusalOf,
    refusalWhileDrafting,
    slotStandingForRecipe,
    usesSlots,
    type PrivateRule,
    type RecipePrivateFacts,
    type SlotStanding,
} from './recipePrivateGate.js';
import { useGatedPrivate } from './useGatedPrivate.js';
import { useMakePublicConfirm } from './useMakePublicConfirm.js';

/** Options for {@link usePrivateChoice}. */
export interface UsePrivateChoiceOptions {
    /** The viewer's paid-feature state (`paidFeatureStateOf`), for what is SHOWN. */
    readonly state: PaidFeatureState;
    /**
     * The profile's own answer (`knownPaidFeaturesOf`), for what will be SENT: `undefined` while it is unknown, a failed
     * read included. REQUIRED, so a host cannot decide a write from the display's fail-closed `hidden`.
     */
    readonly knownPaidFeatures: Exclude<PaidFeatureState, 'loading'> | undefined;
    /** Which rule the recipe is under (`privateRuleOf`): the cook's slots, or (an imported public-web recipe) Premium. */
    readonly rule: PrivateRule;
    /** Where the cook stands on private slots (`slotStandingOf`, from `usePrivateSlots`): the cook's own, whatever the recipe. */
    readonly standing: SlotStanding;
    /**
     * Whether the recipe holds a slot yet (ADR-0073 section 12: a DRAFT holds none). `published` is the recipe's stored
     * status.
     */
    readonly publication: { readonly published: boolean };
    /** The visibility the server held when the editor opened (`public` for a recipe never saved). */
    readonly saved: RecipeVisibility;
    readonly values: RecipeFormValues;
    readonly onChange: (next: RecipeFormValues) => void;
}

/** What the host wires into the visibility leaves and the sheet. */
export interface PrivateChoice {
    /** Render `RecipeVisibilityField` when true, `RecipeVisibilityStatement` when false. */
    readonly offersPrivate: boolean;
    /** The facts `RecipeVisibilityField` decides its badge, hint, count and choices from (`heldVisibility` is the held one). */
    readonly field: Pick<RecipeVisibilityFieldProps, 'facts' | 'heldVisibility' | 'privateRefusal'>;
    /** For `RecipeVisibilityField.onPremiumRequired`: open the Premium sheet (only while the upsell stands). */
    readonly onPremiumRequired: () => void;
    /** For `RecipeVisibilityField.onConfirmPublic`: Public at once, or the confirm first (`useMakePublicConfirm`). */
    readonly onConfirmPublic: () => void;
    /** For `RecipeMakePublicDialog`. Confirming changes the draft only, so it is never busy and never fails. */
    readonly confirm: Pick<RecipeMakePublicDialogProps, 'open' | 'consequence' | 'onConfirm' | 'onKeep'>;
    /**
     * For `RecipeVisibilityStatement`: a kept draft's Private the server will refuse (`refusedDraftPrivate`), and
     * whether the cook confirmed Public here, so the statement replaces the field they used and takes its focus.
     */
    readonly statement: RecipeVisibilityStatementProps;
    /** For `RecipeUpsellSheet`. */
    readonly sheet: RecipeUpsellSheetProps;
}

/**
 * The Private choice for one editor.
 *
 * @param options - The viewer's state, the recipe's rule and the cook's slot standing, the saved visibility, the draft
 *   and how to change it.
 * @returns What the visibility leaves and the Premium sheet are wired with.
 * @sideEffect Applying Private changes the draft through `onChange`.
 */
export function usePrivateChoice(options: UsePrivateChoiceOptions): PrivateChoice {
    const { state, rule, values, onChange, publication } = options;
    // ⛔ A DRAFT holds no slot: its standing is `draft` (nothing to count or refuse) until a Publish was refused for want of one.
    const standing = slotStandingForRecipe(options.standing, publication);
    // What is SHOWN reads the display state; what is SENT reads the profile's own answer (a failed read is no refusal).
    const shown: RecipePrivateFacts = { rule, standing, state };
    const known: RecipePrivateFacts = { rule, standing, state: options.knownPaidFeatures ?? 'loading' };
    // A draft is never SHOWN as refused for slots - not even after a refused Publish: its Private stays chosen, and the
    // real standing (above) is what draws the refusal and its ways forward.
    const refusal = publication.published
        ? recipePrivateRefusalOf(known)
        : refusalWhileDrafting(recipePrivateRefusalOf(known));
    // ⛔ Not `options.saved`: a cook who has moved the draft off Private has given up the free return to it. And under the
    // slots rule a recipe that is not published holds no slot whatever it is stored as (a private DRAFT is stored Private),
    // so there is nothing held to return to: Publish is what takes the slot.
    const heldByTheServer = usesSlots(rule) && !publication.published ? RecipeVisibility.PUBLIC : options.saved;
    const saved = heldVisibility(heldByTheServer, values.visibility);
    const gate = useGatedPrivate({
        facts: shown,
        saved,
        apply: () => onChange({ ...values, visibility: RecipeVisibility.PRIVATE }),
    });
    // The confirm's words say what is KNOWN, and public is never final: it frees a slot, or (an imported public-web
    // recipe, upsell only) Premium is needed to return.
    const makePublic = useMakePublicConfirm({
        consequence: recipeMakePublicConsequence(known, saved),
        fallback: 'frees',
        apply: (done) => {
            onChange({ ...values, visibility: RecipeVisibility.PUBLIC });
            done();
        },
    });

    // A draft whose Private will be SENT (no known refusal) shows as Private, whatever the display state: a statement
    // saying "Public" over a write that sends Private would be false. (Under the slots rule the gate always offers it, so a
    // kept Private the slots refuse still shows the field - where the refusal and its ways forward are.)
    // Owner ruling 2026-10-26: an imported public-web recipe with paid features KNOWN to be hidden (a failed read is not) shows the field too, with Private
    // REFUSED and the reason as its description, rather than a statement with no Private card.
    const offersPrivate =
        gate.offersPrivate ||
        effectiveVisibility(refusal, saved, values.visibility) === RecipeVisibility.PRIVATE ||
        (rule === 'premium' && known.state === 'hidden');

    return {
        offersPrivate,
        field: { facts: known, heldVisibility: saved, privateRefusal: refusal },
        onPremiumRequired: gate.showPremium,
        onConfirmPublic: makePublic.request,
        confirm: makePublic.dialog,
        statement: {
            focusOnMount: makePublic.confirmed,
        },
        sheet: gate.sheet,
    };
}
