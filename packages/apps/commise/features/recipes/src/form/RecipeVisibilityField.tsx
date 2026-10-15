/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (web): "Who can see it"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.7 item 2), a radio group of two cards, Public and Private.
 *
 * The host renders it only when Private is offered (`offersPrivate`); otherwise `RecipeVisibilityStatement`. Under
 * `upsell`, Private carries the Premium badge and choosing it calls `onPremiumRequired` instead of changing the value:
 * the upsell decides, and nothing is pre-selected for it (`visibilityChoice`). A recipe that is already private stays
 * private and shows so. For a downgraded owner, choosing Public on it calls `onConfirmPublic` instead — the confirm
 * decides — and the Public card says beforehand what it costs (`visibilityFieldOf`; plan 2026-10-14-009 D14, Q5).
 *
 * Presentational and controlled. The native leaf is `./RecipeVisibilityField.native.tsx`.
 *
 * @pattern Policy — `visibilityChoice` decides what a choice does; the paid-feature state only derives the badge, the
 *     note and that decision's input, it selects no second mode of the field
 */
import { useMessages } from '@commise/i18n/react';
import { StatusBadge } from '@commise/ui/status-badge';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { editorMessages } from '../editor/messages.js';
import { recipeFormMessages } from './messages.js';
import { visibilityChoice, visibilityFieldOf, type RecipeVisibilityFieldProps } from './props.js';

// Layout and state-independent chrome only. The two state classes below are mutually exclusive, never layered on each
// other: Tailwind's emission order, not the attribute's, decides between two utilities of one property.
const card =
    'flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2 focus-within:ring-2 focus-within:ring-focus-ring';
const cardResting = 'border-line-control bg-paper';
const cardChosen = 'border-selected-edge bg-selected-fill';

/** "Who can see it": Public or Private. */
export const RecipeVisibilityField: FC<RecipeVisibilityFieldProps> = ({
    values,
    onChange,
    paidFeatures,
    savedVisibility,
    onPremiumRequired,
    onConfirmPublic,
}) => {
    const m = useMessages(recipeFormMessages);
    const { visibility: v } = useMessages(editorMessages);
    const { shown, options } = visibilityFieldOf({
        draft: values.visibility,
        saved: savedVisibility,
        state: paidFeatures,
        messages: v,
    });

    const choose = (chosen: RecipeVisibility): void => {
        const next = visibilityChoice(shown, chosen, savedVisibility, paidFeatures);

        if (next === 'premiumRequired') {
            onPremiumRequired?.();
        } else if (next === 'confirmPublic') {
            onConfirmPublic();
        } else if (next !== undefined) {
            onChange({ ...values, ...next });
        }
    };

    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-label text-ink-muted">{v.legend}</legend>
            <div className="grid grid-cols-1 gap-2 @regular/main:grid-cols-2">
                {options.map((option) => {
                    const chosen = shown === option.value;
                    const titleId = `recipe-visibility-${option.value}`;
                    const hintId = `${titleId}-hint`;
                    const badgeId = `${titleId}-badge`;
                    const noteId = `${titleId}-note`;
                    const describedBy = [
                        hintId,
                        ...(option.note === undefined ? [] : [noteId]),
                        ...(option.premium ? [badgeId] : []),
                    ].join(' ');

                    return (
                        <label key={option.value} className={`${card} ${chosen ? cardChosen : cardResting}`}>
                            <input
                                type="radio"
                                name="recipe-visibility"
                                value={option.value}
                                checked={chosen}
                                onChange={() => choose(option.value)}
                                aria-labelledby={titleId}
                                aria-describedby={describedBy}
                                className="size-5 shrink-0 accent-action"
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span id={titleId} className="text-body font-semibold text-ink">
                                    {option.title}
                                </span>
                                <span id={hintId} className="text-meta text-ink-muted">
                                    {option.hint}
                                </span>
                                {option.note === undefined ? null : (
                                    <span id={noteId} className="text-meta text-ink-muted">
                                        {option.note}
                                    </span>
                                )}
                            </span>
                            {option.premium ? (
                                <span id={badgeId} className="shrink-0">
                                    <StatusBadge status="pro">{m.premiumBadge}</StatusBadge>
                                </span>
                            ) : null}
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
};
