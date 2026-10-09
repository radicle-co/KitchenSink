'use client';

/**
 * @module @commise/features-recipes/editor — Paste a list, composed ONCE for both editor containers (build spec
 * §7.5.4; owner decision D10): the paste (`usePasteIntoIngredients`), its sheet (`usePasteListSheet`), and where the
 * section offers it — in the heading row once the section has lines, beside the add field while it is empty, and
 * nowhere once the recipe is stored on the server.
 *
 * While a paste's lines are still joining the recipe, `pending` holds Publish: a recipe published then would lose
 * them, and the rows themselves say "Reading…".
 *
 * @pattern Facade — one entry point over the paste and its sheet, for the two containers
 */
import { useMessages } from '@commise/i18n/react';

import type { DraftAction } from '../form/draftAction.js';
import { recipeFormMessages } from '../form/messages.js';
import type { IngredientsPasteView } from '../form/props.js';
import { usePasteIntoIngredients } from './usePasteIntoIngredients.js';
import { usePasteListSheet, type PasteListSheet } from './usePasteListSheet.js';

/** Options for {@link useIngredientsPaste}. */
export interface UseIngredientsPasteOptions {
    /** The recipe has a server row (D10: nothing offers paste then). */
    readonly stored: boolean;
    readonly dispatch: (action: DraftAction) => void;
    /** The draft's ingredient lines: an empty section offers paste beside its add field rather than in its heading. */
    readonly lineCount: number;
    /** Open the sheet at once: Home's first-run Paste ingredients (§7.5.4). */
    readonly initiallyOpen: boolean;
}

/** What a container wires. */
export interface IngredientsPaste {
    /** What the field group draws (`RecipeIngredientsFieldsProps.paste`). */
    readonly view: IngredientsPasteView;
    /** Whether the section's heading row offers Paste a list. */
    readonly inHeading: boolean;
    /** Opens the sheet: the heading's button. */
    readonly open: () => void;
    readonly sheet: PasteListSheet;
    /** The sheet's busy and failed states, for `PasteListSheet`. */
    readonly submitting: boolean;
    readonly failed: boolean;
    /** A paste is being sent or its lines are still joining the recipe: Publish waits. */
    readonly pending: boolean;
}

/**
 * Paste a list, for one editor.
 *
 * @param options - Whether the recipe is stored, the draft's transition, its line count, and whether to open at once.
 * @returns What the container wires.
 * @sideEffect Through `usePasteIntoIngredients`: creates and polls the parse job, and appends the lines it settles.
 */
export function useIngredientsPaste(options: UseIngredientsPasteOptions): IngredientsPaste {
    const m = useMessages(recipeFormMessages);
    const paste = usePasteIntoIngredients({ stored: options.stored, dispatch: options.dispatch });
    const sheet = usePasteListSheet(paste, {
        initiallyOpen: options.initiallyOpen,
        copy: { lineTooLong: m.pasteRefusalLineTooLong, tooManyLines: m.pasteRefusalTooManyLines },
    });
    const empty = options.lineCount === 0 && paste.reading.length === 0;
    const open = (): void => sheet.setOpen(true);

    return {
        view: {
            reading: paste.reading,
            onRetry: paste.retry,
            added: paste.added,
            onOpen: paste.available && empty ? open : undefined,
        },
        inHeading: paste.available && !empty,
        open,
        sheet,
        submitting: paste.submitting,
        failed: paste.failed,
        pending: paste.submitting || paste.reading.length > 0,
    };
}
