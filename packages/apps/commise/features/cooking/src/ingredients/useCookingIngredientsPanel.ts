'use client';

/**
 * @module useCookingIngredientsPanel — what a cooking screen draws for the ingredients: the top bar's Ingredients
 * action, the scale note, the sheet and the column. It binds `useCookingIngredients` once, so the control, the note
 * and the list read one list. It derives every part for either band. Web draws them all and CSS picks by band
 * (`TWO_COLUMN`), because the screen can arrive in the server HTML. Native has no server render, so it picks with
 * `panelForBand`.
 *
 * Narrow, the sheet is the only way to the list, so the action and the note's open button exist. Wide, the column is in
 * view, so neither does and the note stands alone. The sheet closes whenever `wide` changes, so a window that goes wide
 * and back never reopens it. It gives the list no `onClear`: Clear ticks ships only with its Undo on the cooking
 * snackbar, which is not on main yet (P60). A recipe with no ingredient lines offers nothing to open.
 *
 * @pattern Presentation Model: the screens' ingredient display state derived once, so a screen only draws it.
 * @pattern State: the sheet is open or closed, and a change of band closes it.
 */
import { useState } from 'react';

import type { CookingAction, CookingRecipe } from '../cookingViewProps.js';
import type { CookingMessages } from '../messages.js';

import type { CookingIngredientsColumnProps, CookingIngredientsSheetProps } from './cookingIngredientsFrameProps.js';
import type { CookingScaleNoteProps } from './cookingScaleNoteProps.js';
import { useCookingIngredients } from './useCookingIngredients.js';

/** What the panel is derived from. */
export interface UseCookingIngredientsPanelInput {
    readonly recipe: CookingRecipe;
    readonly copy: CookingMessages;
    readonly locale: string;
    /** Whether the ingredients are a column beside the step (L2 and L3). */
    readonly wide: boolean;
}

/** What a screen draws. Each part is absent where the band or the recipe leaves nothing to draw. */
export interface CookingIngredientsPanel {
    /** The top bar's Ingredients button. Web hides it from the band in CSS, native with `panelForBand`. */
    readonly topAction?: CookingAction;
    /** The scale note, while the servings differ from the recipe's. Its `onOpen` is gone at two columns. */
    readonly scaleNote?: CookingScaleNoteProps;
    /** The sheet, closed until the cook opens it. */
    readonly sheet?: CookingIngredientsSheetProps;
    /** The column. */
    readonly column?: CookingIngredientsColumnProps;
}

/**
 * Derive the ingredients panel.
 *
 * @param input - The recipe, the copy, the locale and the band.
 * @returns The parts to draw.
 * @sideEffect Subscribes to the cook marks and the serving scale; a tick writes the cook's marks.
 */
export function useCookingIngredientsPanel(input: UseCookingIngredientsPanelInput): CookingIngredientsPanel {
    const { recipe, copy, locale, wide } = input;
    const binding = useCookingIngredients({ recipe, copy, locale });
    const [open, setOpen] = useState(false);
    const [seenWide, setSeenWide] = useState(wide);

    // Adjusting state during render from the previous band: no effect and no ref, and no frame draws a stale sheet.
    if (seenWide !== wide) {
        setSeenWide(wide);
        setOpen(false);
    }

    const { view } = binding;

    if (view.kind === 'none') {
        return {};
    }

    const openSheet = () => {
        setOpen(true);
    };

    const list = {
        view,
        onToggle: binding.toggle,
        onSetServings: binding.setServings,
    };

    return {
        topAction: { label: copy.top.ingredients, onPress: openSheet },
        sheet: {
            ...list,
            copy: { clear: copy.ingredients.clear, close: copy.ingredients.close },
            open,
            onClose: () => {
                setOpen(false);
            },
        },
        column: { ...list, copy: { clear: copy.ingredients.clear } },
        ...(view.scaleNote === undefined
            ? {}
            : { scaleNote: { note: view.scaleNote, openLabel: copy.step.scaleNoteOpen, onOpen: openSheet } }),
    };
}

/**
 * Choose the parts one band draws, for a platform that knows its band when it renders (native has no server render).
 * Wide: the column and the note without its open button, because the column is in view. Narrow: the action, the sheet
 * and the note with its button. Web draws every part and lets CSS choose (`TWO_COLUMN`), so it never calls this. Pure.
 *
 * @param panel - What {@link useCookingIngredientsPanel} derived.
 * @param wide - Whether the ingredients are a column beside the step.
 * @returns The parts to draw.
 */
export function panelForBand(panel: CookingIngredientsPanel, wide: boolean): CookingIngredientsPanel {
    const { scaleNote, column, topAction, sheet } = panel;

    if (wide) {
        return {
            ...(column === undefined ? {} : { column }),
            ...(scaleNote === undefined ? {} : { scaleNote: { note: scaleNote.note, openLabel: scaleNote.openLabel } }),
        };
    }

    return {
        ...(topAction === undefined ? {} : { topAction }),
        ...(sheet === undefined ? {} : { sheet }),
        ...(scaleNote === undefined ? {} : { scaleNote }),
    };
}
