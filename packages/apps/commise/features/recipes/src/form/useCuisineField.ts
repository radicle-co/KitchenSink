/**
 * @module @commise/features-recipes/form — `useCuisineField`, the Cuisine field's behaviour, shared by the web and native
 * leaves of `RecipeBasicsFields` (`docs/design/uiOverhaul/cuisineField.md` §3, §4).
 *
 * It owns the three things the design gives the HOST rather than the combobox primitive:
 *
 * - `editedSinceFocus`: the text filters the list only after the cook's first edit since the field took focus, so a
 *   committed "Thai" does not hide the other 89 when the cook comes back to change it.
 * - Commit: a pick commits the entry; Enter or Done with nothing chosen, and leaving the field, commit the typed text in
 *   its CANONICAL form (`canonicalCuisine`), so the cook sees the exact string that will be saved. The wire applies it
 *   again as a safety net.
 * - The polite count (4.1.3), changed only after the same 500 ms pause the ingredient entry's live reading waits for, so
 *   it is not spoken on every keystroke.
 *
 * @pattern Headless Hook — the field's state and commands, rendered by both platform leaves
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { ComboboxGroup, ComboboxStatus } from '@commise/ui/combobox';
import { canonicalCuisine } from '@kitchensink/recipe-core';
import { useState } from 'react';

import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { cuisineCommitOf, cuisineFieldView } from './cuisineField.js';
import { recipeFormMessages } from './messages.js';
import { LIVE_READING_PAUSE_MS } from './useIngredientsFields.js';

/** What the field is bound to. */
export interface CuisineFieldBinding {
    /** The form's cuisine. */
    readonly value: string;
    /** Called with the new cuisine on every edit and commit. */
    readonly onChange: (cuisine: string) => void;
}

/** The combobox props the hook owns; a leaf adds the id, the copy, the error and its platform's props. */
export interface CuisineField {
    readonly value: string;
    readonly groups: readonly ComboboxGroup[];
    /** The no-match note (S5), absent otherwise. */
    readonly status?: ComboboxStatus;
    readonly countAnnouncement: string;
    readonly onValueChange: (text: string) => void;
    readonly onSelect: (key: string) => void;
    readonly onFocus: () => void;
    readonly onBlur: () => void;
    readonly onSubmitWithoutChoice: () => void;
}

/**
 * The Cuisine field's state and commands.
 *
 * @param binding - The form's cuisine and its setter.
 * @returns The combobox props the hook owns.
 */
export function useCuisineField({ value, onChange }: CuisineFieldBinding): CuisineField {
    const messages = useMessages(recipeFormMessages);
    const locale = useLocale();
    const [editedSinceFocus, setEditedSinceFocus] = useState(false);
    const view = cuisineFieldView({ text: value, filtering: editedSinceFocus, messages, locale });
    const countAnnouncement = useDebouncedValue(view.announcement, LIVE_READING_PAUSE_MS);

    const commitTyped = (): void => {
        const canonical = canonicalCuisine(value);

        if (canonical !== value) {
            onChange(canonical);
        }
    };

    return {
        value,
        groups: view.groups,
        ...(view.status === undefined ? {} : { status: view.status }),
        countAnnouncement,
        onValueChange: (text) => {
            setEditedSinceFocus(true);
            onChange(text);
        },
        onSelect: (key) => {
            onChange(cuisineCommitOf(key, value));
        },
        onFocus: () => {
            setEditedSinceFocus(false);
        },
        onBlur: commitTyped,
        onSubmitWithoutChoice: commitTyped,
    };
}
