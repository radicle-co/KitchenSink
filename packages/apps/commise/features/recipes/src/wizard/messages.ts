/**
 * @module @commise/features-recipes/wizard/messages — user-facing copy for the 4-step recipe-edit wizard
 * shell (w3/e1,e2; U32/U33): the step rail, the sticky header (its back affordance and desktop overflow
 * menu), the pinned action bar's Previous / Save Draft / Next controls, and the discard-confirmation dialog.
 * Its own {@link LocalizedMessages} dictionary, consumed by BOTH the web `Wizard.tsx` and native
 * `Wizard.native.tsx` leaves via `useMessages`, mirroring `../form/messages.ts`'s shape so the two platforms
 * cannot drift on wizard chrome copy.
 *
 * ⛔ The `preview*` block is DELETED, not unused (owner ruling 2026-08-25): step 4 is now Review, and two
 * surfaces rendering the same draft drift. `__tests__/messages.test.ts` asserts its absence, because a
 * leftover key is exactly how a deleted surface gets quietly restored.
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { RecipeWizardStep } from '../form/model.js';

/** Shared copy for the recipe-edit wizard shell, rendered by both the web and native wizard leaves. */
export interface WizardMessages {
    /**
     * The step-rail's step names, KEYED BY STEP (FR-044; U33).
     *
     * ⛔ A `Record<RecipeWizardStep, string>`, not the positional 4-tuple it used to be. The tuple was read as
     * `stepNames[step - 1] ?? ''` in BOTH platform leaves and in both the rail and the Prev/Next labels — four
     * index computations whose only failure mode was a silently EMPTY label, which no test could see because
     * an empty string renders as nothing. Keying by the step makes the association the type: every step in
     * `WIZARD_STEPS` must have a name, the `?? ''` fallbacks are gone, and adding or removing a step is a
     * compile error at every construction site rather than a blank pill in the rail.
     */
    readonly stepNames: Readonly<Record<RecipeWizardStep, string>>;
    /** "Step {current} of {total}" progress label template (FR-044). */
    readonly stepProgress: string;
    /** Accessible label for the step-rail region. */
    readonly railLabel: string;
    /** Accessible label template for one rail step's status announcement (contains `{name}`, `{state}`). */
    readonly railStepLabel: string;
    /**
     * Accessible label for the sticky wizard HEADER region (U32) — the back affordance, the heading, the
     * desktop overflow menu and the action bar. Its OWN landmark name, deliberately distinct from
     * {@link railLabel} and {@link controlsLabel} so no two regions on this surface share one name.
     */
    readonly headerLabel: string;
    /**
     * Accessible name for the header's BACK affordance (U32, owner ruling 2026-08-25). Below `lg` it replaces
     * the overflow menu's `Cancel` item outright — and it routes through the SAME `requestCancel` that item
     * did, so the discard guard still fires. It is not a browser-history control and must never be wired to
     * one: leaving an edit with unsaved work is a decision, not a navigation.
     */
    readonly back: string;
    /**
     * The header's title when the draft has no title yet (U32).
     *
     * ⛔ The header names the RECIPE, not the step. Naming the step there duplicated every step body's own
     * section heading — on the Review step that produced two headings called "Review" on one screen, and on
     * steps 2 and 3 it would have produced two called "Ingredients" and "Instructions". The step is already
     * announced twice over, by the rail's "Step N of 4" and by the section heading; what a cook cannot see
     * anywhere else is which recipe they are editing.
     */
    readonly untitledRecipe: string;
    /**
     * Accessible name for the header's overflow ("More actions") menu — used BOTH for the kebab trigger button
     * and for the `role="menu"` list it discloses (Save Draft / Cancel), so neither is an unnamed control.
     * The secondary/destructive actions live here so the header never packs four filled buttons (plan U6).
     */
    readonly actionsMenu: string;
    /** Rail step-state word: completed. */
    readonly stateCompleted: string;
    /** Rail step-state word: current. */
    readonly stateCurrent: string;
    /** Rail step-state word: invalid. */
    readonly stateInvalid: string;
    /** Rail step-state word: upcoming. */
    readonly stateUpcoming: string;

    /** Save-Draft action label — the action bar's middle slot (U32). */
    readonly saveDraft: string;
    /** Cancel action label — the desktop overflow menu's destructive item (U32; below `lg` it is the back arrow). */
    readonly cancel: string;
    /**
     * The final-submit action's label, in BOTH create and edit mode (w3/e7: reconciled with its behavior —
     * this button always sets `status: 'published'`, so it is named `Publish` regardless of mode; `Save
     * Draft` is the separate, non-publishing action). Previously two distinct PRESERVED labels
     * (`Create recipe` / `Save changes`) that named the action's MODE rather than what it actually DID.
     */
    readonly publish: string;

    /**
     * Action-bar Previous label template (contains `{name}`, the PRECEDING step's name).
     *
     * Carries NO decorative `<` — direction is conveyed by the button's own `chevron-left` icon on BOTH
     * platforms. A glyph here duplicates that icon visually and, because the label is also the button's
     * accessible name, makes a screen reader announce the punctuation ("less-than Prev: Basic").
     */
    readonly prevLabel: string;
    /** Action-bar Next label template (contains `{name}`, the FOLLOWING step's name). See {@link prevLabel}
     *  for why it carries no decorative `>`. */
    readonly nextLabel: string;
    /** Accessible label for the pinned action-bar (Previous / Save Draft / Next) region. */
    readonly controlsLabel: string;

    /** Discard-confirmation dialog title. */
    readonly discardTitle: string;
    /** Discard-confirmation dialog body. */
    readonly discardBody: string;
    /** Discard-confirmation dialog's destructive confirm action. */
    readonly discardConfirm: string;
    /** Discard-confirmation dialog's "keep editing" cancel action. */
    readonly discardCancel: string;
}

export const wizardMessages: LocalizedMessages<WizardMessages> = {
    en: {
        stepNames: { 1: 'Details', 2: 'Ingredients', 3: 'Instructions', 4: 'Review' },
        stepProgress: 'Step {current} of {total}',
        railLabel: 'Recipe wizard steps',
        railStepLabel: '{name}: {state}',
        headerLabel: 'Recipe wizard actions',
        back: 'Back',
        untitledRecipe: 'New recipe',
        actionsMenu: 'More actions',
        stateCompleted: 'completed',
        stateCurrent: 'current step',
        stateInvalid: 'needs attention',
        stateUpcoming: 'not yet started',

        saveDraft: 'Save Draft',
        cancel: 'Cancel',
        publish: 'Publish',

        prevLabel: 'Prev: {name}',
        nextLabel: 'Next: {name}',
        controlsLabel: 'Wizard step navigation',

        discardTitle: 'Discard unsaved changes?',
        discardBody: 'You have unsaved changes. Leaving now will discard them.',
        discardConfirm: 'Discard changes',
        discardCancel: 'Keep editing',
    },
};
