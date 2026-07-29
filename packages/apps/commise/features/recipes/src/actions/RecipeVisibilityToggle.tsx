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
    error = false,
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

    const pill = (active: boolean) =>
        `relative cursor-pointer rounded-full px-4 py-1.5 text-body-sm font-medium transition ${
            active ? 'bg-card text-charcoal shadow-sm' : 'text-slate'
        }`;
    // The radio is a transparent overlay filling its pill, so the semantic control is the click/tap target
    // itself (directly actionable for pointer users + E2E via `getByRole('radio')`) with the pill label
    // beneath — not a 1px `sr-only` point the label would overlay and pointer drivers could not reach.
    const radioOverlay = 'absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed';

    return (
        <fieldset aria-label={messages.groupLabel} className="flex flex-col gap-2">
            <div className="inline-flex w-fit gap-1 rounded-full bg-pearl p-1">
                <label className={pill(visibility === RecipeVisibility.PUBLIC)}>
                    <input
                        type="radio"
                        name={groupName}
                        className={radioOverlay}
                        checked={visibility === RecipeVisibility.PUBLIC}
                        onChange={() => onChange(RecipeVisibility.PUBLIC)}
                    />
                    {messages.publicLabel}
                </label>
                <label
                    className={`${pill(visibility === RecipeVisibility.PRIVATE)} ${
                        canGoPrivate ? '' : 'cursor-not-allowed opacity-50'
                    }`}
                >
                    <input
                        type="radio"
                        name={groupName}
                        className={radioOverlay}
                        checked={visibility === RecipeVisibility.PRIVATE}
                        disabled={!canGoPrivate}
                        aria-describedby={showReason ? reasonId : undefined}
                        onChange={selectPrivate}
                    />
                    {messages.privateLabel}
                </label>
            </div>
            {showReason && (
                <p id={reasonId} className="text-body-sm text-warning">
                    {disabledReason}
                </p>
            )}
            {error && (
                <p role="alert" className="text-body-sm text-error-dark">
                    {messages.error}
                </p>
            )}
        </fieldset>
    );
};
