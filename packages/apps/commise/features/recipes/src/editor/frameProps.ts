/**
 * @module @commise/features-recipes/editor — the shared contracts of the editor frame's leaves (header, section, action
 * bar, notices), which the web and native leaves both implement, and the element ids the web popups read the chrome's
 * edges by.
 */
import type { IconName } from '@commise/ui/icon-names';
import type { ReactNode } from 'react';

import type { UseRecipeEditorResult } from '../hooks/useRecipeEditor.js';
import type { GateOutcome } from './gate.js';
import type { OpenChoicesFacts } from './openChoicesCopy.js';
import type { DraftKeep } from './saveStatus.js';
import type { EditorSectionId } from './sections.js';
import type { ResolvedArrival } from './editorArrival.js';

/** The header's element id: the popups in the sections read its edge to keep clear of it (`chromeInsets.ts`). */
export const EDITOR_HEADER_ID = 'recipe-editor-header';

/** Props for `EditorHeader`. */
export interface EditorHeaderProps {
    readonly title: string;
    /** The save status, or `undefined` when there is nothing to say yet. */
    readonly status: string | undefined;
    readonly closeLabel: string;
    readonly onClose: () => void;
    /** The ⋯ menu, when there is something to discard. */
    readonly menu?: {
        readonly triggerLabel: string;
        readonly closeLabel: string;
        readonly discardLabel: string;
        readonly onDiscard: () => void;
        /** Why Discard cannot be used now ("Saving…"); the item stays, reads as unavailable, and runs nothing. */
        readonly discardUnavailable?: string;
    };
}

/** Props for `EditorSection`. */
export interface EditorSectionProps {
    readonly id: EditorSectionId;
    readonly title: string;
    /** Controls in the heading row (Paste steps; slice 8's Paste a list). */
    readonly action?: ReactNode;
    /**
     * Native: advances when a jump lands on this section, and the heading then takes the screen-reader cursor. Web
     * ignores it: the page's `ScrollHost` moves DOM focus to the heading by its id.
     */
    readonly focusSignal?: number;
    /** Whether this is the section the cook is in (the scroll spy's current one). Its leaves read it (`sectionPresence`). */
    readonly current: boolean;
    readonly children: ReactNode;
}

/** The bar's element id: the popups in the sections read its edge to keep clear of it (`chromeInsets.ts`). */
export const EDITOR_ACTION_BAR_ID = 'recipe-editor-actions';

/** The section index's sticky boxes are named from this (`SectionIndex`'s `stickyId`). */
export const EDITOR_INDEX_ID = 'recipe-editor-index';

/**
 * Every box that sticks at the top of the web editor: the header, and below 960 px the index's strip or phone bar under
 * it. Popups keep clear of the lowest (`readChromeInsets`).
 */
export const EDITOR_TOP_CHROME_IDS: readonly string[] = [
    EDITOR_HEADER_ID,
    `${EDITOR_INDEX_ID}-strip`,
    `${EDITOR_INDEX_ID}-bar`,
];

/** What the action bar shows while a finish waits for its photos. */
export interface PhotoFinishBar {
    /** "Recipe saved. Finishing your photo uploads…", or how many photos failed. */
    readonly line: string;
    /** A photo failed: the line is in the danger tone. */
    readonly danger: boolean;
    /** "Finish without the remaining photos". */
    readonly actionLabel: string;
    readonly onAction: () => void;
    /** The control takes focus: the button the cook pressed is gone (SC 2.4.3). */
    readonly focusRequested: boolean;
    readonly onFocusRequestHandled: () => void;
}

/** Props for `EditorActionBar`. */
export interface EditorActionBarProps {
    readonly label: string;
    readonly previewLabel: string;
    readonly onPreview: () => void;
    readonly primaryLabel: string;
    readonly onPrimary: () => void;
    /** Nothing to save yet (a published recipe with no device changes). */
    readonly primaryDisabled: boolean;
    /** A Publish or Save changes waits for its answer. */
    readonly busy: boolean;
    /** "Fix {n} things to publish", after a refused Publish. */
    readonly fixLine?: string;
    /** "Ready to publish. {n} ingredients have no match…" (owner D20): quiet, and Publish stays enabled. */
    readonly readyLine?: string;
    /** An alert about a parked write, shown above the controls. */
    readonly notice?: ReactNode;
    /**
     * The editor finished but waits for its photos (`useEditorPhotos`): the line and the one control that replace Preview
     * and the primary. A second Publish would make a second recipe, so the primary is not offered at all.
     */
    readonly finishing?: PhotoFinishBar;
    /**
     * The on-screen keyboard is up (native only, A-006): it covers the system navigation bar, so the bar stops padding
     * for it. The web bar ignores this.
     */
    readonly keyboardShown?: boolean;
}

/** Props for `ResumeNotice`. */
export interface ResumeNoticeProps {
    /** "You have changes from {time} that aren't saved to your recipe.", filled. */
    readonly body: string;
    readonly saveLabel: string;
    readonly discardLabel: string;
    readonly onSave: () => void;
    readonly onDiscard: () => void;
    /** Why Discard cannot be used now ("Saving…"): the button is disabled and the reason is said beside it. */
    readonly discardUnavailable?: string;
}

/** One control of the parked-write alert. */
export interface FailureAction {
    readonly label: string;
    readonly icon: IconName;
    readonly onPress: () => void;
}

/** Props for `FailureAlert`. */
export interface FailureAlertProps {
    readonly body: string;
    /** The cook's first choice, drawn as the primary. */
    readonly primary: FailureAction;
    readonly secondary?: FailureAction;
}

/** Props for `RecipeEditorView`. */
export interface RecipeEditorViewProps {
    readonly editor: UseRecipeEditorResult;
    readonly mode: 'create' | 'edit';
    /** Where the device draft is kept: `tabSession` on web (D7). */
    readonly keep: DraftKeep;
    /** The ingredient entry's uncommitted text (the row editor's). */
    readonly pendingEntryText: string;
    /** The id of the field that holds it, or `undefined` when none does: where a refused Publish takes the cook. */
    readonly pendingEntryFieldId: string | undefined;
    /** A paste is being sent, or its lines are still joining the recipe: Publish waits (`useIngredientsPaste`). */
    readonly pastePending?: boolean;
    /**
     * A paste's lines are still being read or matched, so Ingredients says "Reading…" and is not complete. Narrower than
     * {@link pastePending}: false once every unjoined line failed and waits on the cook (`useIngredientsPaste`).
     */
    readonly pasteReading?: boolean;
    /** How many pasted lines failed and wait on the cook, nothing in flight: Ingredients says "Needs you". */
    readonly pasteNeedsYou?: number;
    /**
     * What the last finished paste added (`useIngredientsPaste`'s `added`). The editor's one polite region says it, with
     * "Ingredients complete" when the same settle completes the section.
     */
    readonly pasteAdded?: { readonly count: number; readonly occurrence: number };
    /**
     * The paste's lines that have no food yet (R23): Publish asks first. `facts` is `undefined` while no line needs a pick,
     * and Publish goes straight through; `chooseNow` opens the first of them.
     */
    readonly openChoices?: { readonly facts: OpenChoicesFacts | undefined; readonly chooseNow: () => void };
    /** Each section's body. */
    readonly sections: Readonly<Record<EditorSectionId, ReactNode>>;
    /** Controls in a section's heading row (Paste steps; slice 8's Paste a list). */
    readonly headingActions?: Partial<Readonly<Record<EditorSectionId, ReactNode>>>;
    /** The rail's foot (the nutrition total). */
    readonly railFooter?: ReactNode;
    /**
     * Where a deep link opens (the URL's hash, the native route params): the section, and the line the surface resolved
     * from the link's address. Jumped to once on mount (blueprint A16).
     */
    readonly arrival?: ResolvedArrival;
    /** Leave the editor (× ). The editor has already checkpointed the exit. */
    readonly onClose: () => void;
    /**
     * Ask before a leave that would lose photos, then `proceed`; or `proceed` at once. × goes through it BEFORE the exit
     * checkpoint, so a cook who stays has not left (`RecipeEditorSurface`'s `leaveAsk`).
     */
    readonly requestLeave: (proceed: () => void) => void;
    readonly onPreview: () => void;
    /** A Publish or Save changes was refused: the row editor points at its pending text. */
    readonly onRefused?: (outcome: GateOutcome) => void;
    /** "Check My recipes", from an unknown create's alert. */
    readonly onOpenMyRecipes: () => void;
    /**
     * The editor finished (published, or its changes saved) and waits for its photos (`useEditorPhotos`). The page then
     * shows only Photos & publish, where the uploads and their Retry are, and the action bar's Finish control: any other
     * field changed now would be lost, because the editor has already handed off.
     */
    readonly photoFinish?: PhotoFinishBar;
    /**
     * A photo is not uploaded yet: on web, closing the tab would lose it, so the browser asks; and the page stays drawn
     * past the hand-off until the finish holds for it (`editorPageStays`).
     */
    readonly photosAtRisk: boolean;
}
