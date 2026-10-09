/**
 * @module @commise/features-recipes/editor — the shared contracts of the editor frame's leaves (header, section, action
 * bar, notices), which the web and native leaves both implement, and the element ids the web popups read the chrome's
 * edges by.
 */
import type { IconName } from '@commise/ui/icon-names';
import type { ReactNode } from 'react';

import type { UseRecipeEditorResult } from '../hooks/useRecipeEditor.js';
import type { GateOutcome } from './gate.js';
import type { DraftKeep } from './saveStatus.js';
import type { EditorSectionId } from './sections.js';

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
    /** An alert about a parked write, shown above the controls. */
    readonly notice?: ReactNode;
}

/** Props for `ResumeNotice`. */
export interface ResumeNoticeProps {
    /** "You have changes from {time} that aren't saved to your recipe.", filled. */
    readonly body: string;
    readonly saveLabel: string;
    readonly discardLabel: string;
    readonly onSave: () => void;
    readonly onDiscard: () => void;
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
    /** Whether the cook has never published a recipe: guided progress shows (D1). */
    readonly guided: boolean;
    /** The ingredient entry's uncommitted text (the row editor's). */
    readonly pendingEntryText: string;
    /** A paste is being sent, or its lines are still joining the recipe: Publish waits (`useIngredientsPaste`). */
    readonly pastePending?: boolean;
    /** Each section's body. */
    readonly sections: Readonly<Record<EditorSectionId, ReactNode>>;
    /** Controls in a section's heading row (Paste steps; slice 8's Paste a list). */
    readonly headingActions?: Partial<Readonly<Record<EditorSectionId, ReactNode>>>;
    /** The rail's foot (the nutrition total). */
    readonly railFooter?: ReactNode;
    /** The section a deep link names (the URL's hash), jumped to once on mount (blueprint A16). */
    readonly initialSection?: EditorSectionId;
    /** Leave the editor (× ). The editor has already checkpointed the exit. */
    readonly onClose: () => void;
    readonly onPreview: () => void;
    /** A Publish or Save changes was refused: the row editor points at its pending text. */
    readonly onRefused?: (outcome: GateOutcome) => void;
    /** "Check My recipes", from an unknown create's alert. */
    readonly onOpenMyRecipes: () => void;
}
