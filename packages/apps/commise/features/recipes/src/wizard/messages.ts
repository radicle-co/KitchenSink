/**
 * @module @commise/features-recipes/wizard/messages — user-facing copy for the 4-step recipe-edit wizard
 * shell (w3/e1,e2): the step rail, the top-bar actions, the footer Prev/Next nav, the preview panel, and the
 * discard-confirmation dialog. Its own {@link LocalizedMessages} dictionary, consumed by BOTH the web
 * `Wizard.tsx` and native `Wizard.native.tsx` leaves via `useMessages`, mirroring `../form/messages.ts`'s
 * shape so the two platforms cannot drift on wizard chrome copy.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the recipe-edit wizard shell, rendered by both the web and native wizard leaves. */
export interface WizardMessages {
    /** The step-rail's step names, in order (FR-044). */
    readonly stepNames: readonly [string, string, string, string];
    /** "Step {current} of {total}" progress label template (FR-044). */
    readonly stepProgress: string;
    /** Accessible label for the step-rail region. */
    readonly railLabel: string;
    /** Accessible label template for one rail step's status announcement (contains `{name}`, `{state}`). */
    readonly railStepLabel: string;
    /** Accessible label for the persistent top-bar (Preview + the actions overflow menu) toolbar region — its OWN
     * landmark name, deliberately distinct from {@link railLabel} so two different regions never share one name. */
    readonly topBarLabel: string;
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

    /** Save-Draft top-bar action label. */
    readonly saveDraft: string;
    /** Preview top-bar action label. */
    readonly preview: string;
    /** Cancel top-bar action label. */
    readonly cancel: string;
    /**
     * The final-submit action's label, in BOTH create and edit mode (w3/e7: reconciled with its behavior —
     * this button always sets `status: 'published'`, so it is named `Publish` regardless of mode; `Save
     * Draft` is the separate, non-publishing action). Previously two distinct PRESERVED labels
     * (`Create recipe` / `Save changes`) that named the action's MODE rather than what it actually DID.
     */
    readonly publish: string;

    /** Footer Prev-nav label template (contains `{name}`, the PRECEDING step's name). */
    readonly prevLabel: string;
    /** Footer Next-nav label template (contains `{name}`, the FOLLOWING step's name). */
    readonly nextLabel: string;
    /** Accessible label for the footer step-navigation (`< Prev` / `Next >`) region. */
    readonly controlsLabel: string;

    /** Heading of the minimal read-only preview panel. */
    readonly previewHeading: string;
    /** Accessible label for the preview panel's close action. */
    readonly previewClose: string;
    /** Preview row label: title. */
    readonly previewTitle: string;
    /** Preview row label: description. */
    readonly previewDescription: string;
    /** Preview row label: servings. */
    readonly previewServings: string;
    /** Preview row label: ingredient count. */
    readonly previewIngredientCount: string;
    /** Preview row label: step count. */
    readonly previewStepCount: string;
    /** Preview row label: visibility. */
    readonly previewVisibility: string;
    /** Preview visibility value: public. */
    readonly previewVisibilityPublic: string;
    /** Preview visibility value: private. */
    readonly previewVisibilityPrivate: string;

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
        stepNames: ['Basic', 'Ingredients', 'Instructions', 'Photos'],
        stepProgress: 'Step {current} of {total}',
        railLabel: 'Recipe wizard steps',
        railStepLabel: '{name}: {state}',
        topBarLabel: 'Recipe wizard actions',
        actionsMenu: 'More actions',
        stateCompleted: 'completed',
        stateCurrent: 'current step',
        stateInvalid: 'needs attention',
        stateUpcoming: 'not yet started',

        saveDraft: 'Save Draft',
        preview: 'Preview',
        cancel: 'Cancel',
        publish: 'Publish',

        prevLabel: '< Prev: {name}',
        nextLabel: 'Next: {name} >',
        controlsLabel: 'Wizard step navigation',

        previewHeading: 'Preview',
        previewClose: 'Close preview',
        previewTitle: 'Title',
        previewDescription: 'Description',
        previewServings: 'Servings',
        previewIngredientCount: 'Ingredients',
        previewStepCount: 'Steps',
        previewVisibility: 'Visibility',
        previewVisibilityPublic: 'Public',
        previewVisibilityPrivate: 'Private',

        discardTitle: 'Discard unsaved changes?',
        discardBody: 'You have unsaved changes. Leaving now will discard them.',
        discardConfirm: 'Discard changes',
        discardCancel: 'Keep editing',
    },
};
