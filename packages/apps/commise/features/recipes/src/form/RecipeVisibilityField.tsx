/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (web): "Who can see it"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.7 item 2), a radio group of two cards, Public and Private.
 *
 * For a cook whose plan does not include private recipes, Private carries the Premium badge and choosing it calls
 * `onPremiumRequired` instead of changing the value: the upsell decides, and nothing is pre-selected for it
 * (`visibilityChoice`). A recipe that is already private stays private and shows so.
 *
 * Presentational and controlled. The native leaf is `./RecipeVisibilityField.native.tsx`.
 *
 * @pattern Policy — `visibilityChoice` decides what a choice does; `canGoPrivate` only derives the badge and that
 *     decision's input, it selects no second mode of the field
 */
import { useMessages } from '@commise/i18n/react';
import { StatusBadge } from '@commise/ui/status-badge';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { editorMessages } from '../editor/messages.js';
import { recipeFormMessages } from './messages.js';
import { visibilityChoice, type RecipeVisibilityFieldProps } from './props.js';

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
    canGoPrivate,
    onPremiumRequired,
}) => {
    const m = useMessages(recipeFormMessages);
    const { visibility: v } = useMessages(editorMessages);

    const choose = (chosen: RecipeVisibility): void => {
        const next = visibilityChoice(values.visibility, chosen, canGoPrivate);

        if (next === 'premiumRequired') {
            onPremiumRequired?.();
        } else if (next !== undefined) {
            onChange({ ...values, ...next });
        }
    };

    const options: readonly { value: RecipeVisibility; title: string; hint: string; premium: boolean }[] = [
        { value: 'public', title: v.public, hint: v.publicHint, premium: false },
        { value: 'private', title: v.private, hint: v.privateHint, premium: !canGoPrivate },
    ];

    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-label text-ink-muted">{v.legend}</legend>
            <div className="grid grid-cols-1 gap-2 @regular/main:grid-cols-2">
                {options.map((option) => {
                    const chosen = values.visibility === option.value;
                    const titleId = `recipe-visibility-${option.value}`;
                    const hintId = `${titleId}-hint`;
                    const badgeId = `${titleId}-badge`;

                    return (
                        <label key={option.value} className={`${card} ${chosen ? cardChosen : cardResting}`}>
                            <input
                                type="radio"
                                name="recipe-visibility"
                                value={option.value}
                                checked={chosen}
                                onChange={() => choose(option.value)}
                                aria-labelledby={titleId}
                                aria-describedby={option.premium ? `${hintId} ${badgeId}` : hintId}
                                className="size-5 shrink-0 accent-action"
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span id={titleId} className="text-body font-semibold text-ink">
                                    {option.title}
                                </span>
                                <span id={hintId} className="text-meta text-ink-muted">
                                    {option.hint}
                                </span>
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
