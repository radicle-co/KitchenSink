/**
 * @module @commise/features-recipes — web recipe visibility toggle (T074 building block).
 *
 * Controlled, presentational public/private radio group. The current `visibility` is the checked option and
 * every selection is reported upward via `onChange`. Tier-gated per C-004: when `canGoPrivate` is false the
 * private option is disabled and the (already-localized) `disabledReason` is shown and associated with it.
 * State is conveyed by the radio's checked/disabled semantics and its text label — never by colour alone.
 */
import { useMessages } from '@commise/i18n/react';
import { useId, type FC } from 'react';

import { RecipeVisibility } from '@kitchensink/recipe-core';

import { recipeActionMessages } from './messages.js';
import type { RecipeVisibilityToggleProps } from './model.js';

export const RecipeVisibilityToggle: FC<RecipeVisibilityToggleProps> = ({
    visibility,
    canGoPrivate,
    disabledReason,
    onChange,
}) => {
    const { visibility: messages } = useMessages(recipeActionMessages);
    const groupName = useId();
    const reasonId = useId();
    const showReason = !canGoPrivate && disabledReason !== undefined && disabledReason.length > 0;

    // Enforce the tier gate in the handler too, not only via `disabled`: the component must never emit a
    // transition to a visibility the tier can't select, however the event arrives.
    const selectPrivate = () => {
        if (canGoPrivate) {
            onChange(RecipeVisibility.PRIVATE);
        }
    };

    return (
        <fieldset aria-label={messages.groupLabel}>
            <label>
                <input
                    type="radio"
                    name={groupName}
                    checked={visibility === RecipeVisibility.PUBLIC}
                    onChange={() => onChange(RecipeVisibility.PUBLIC)}
                />
                {messages.publicLabel}
            </label>
            <label>
                <input
                    type="radio"
                    name={groupName}
                    checked={visibility === RecipeVisibility.PRIVATE}
                    disabled={!canGoPrivate}
                    aria-describedby={showReason ? reasonId : undefined}
                    onChange={selectPrivate}
                />
                {messages.privateLabel}
            </label>
            {showReason && <p id={reasonId}>{disabledReason}</p>}
        </fieldset>
    );
};
