/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (web): "Who can see it"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.7 item 2), a radio group of two cards, Public and Private.
 *
 * The host renders it only when Private is offered (`recipeOffersPrivate`); otherwise `RecipeVisibilityStatement`. Private
 * works within the cook's private slots (ADR-0073): the card says how many are left, and with none left it is refused
 * with three ways forward (`slotsFull`). Under the premium rule's `upsell` (an imported public-web recipe), Private carries
 * the Premium badge and choosing it calls `onPremiumRequired` instead of changing the value: the upsell decides, and
 * nothing is pre-selected for it (`visibilityChoice`). A recipe that is already private stays private and shows so.
 * Choosing Public on it calls `onConfirmPublic` where that costs something worth saying (it frees a slot) — the confirm
 * decides — and the Public card says beforehand what it costs (`visibilityFieldOf`; plan 2026-10-14-009 D14, Q5).
 *
 * Presentational and controlled. The native leaf is `./RecipeVisibilityField.native.tsx`.
 *
 * @pattern Policy — `visibilityChoice` decides what a choice does; the paid-feature state only derives the badge, the
 *     note and that decision's input, it selects no second mode of the field
 */
import { useMessages } from '@commise/i18n/react';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { heldVisibility } from '../actions/privateGate.js';
import { editorMessages } from '../editor/messages.js';
import { visibilityChoice, visibilityFieldOf, type RecipeVisibilityFieldProps } from './props.js';

// Layout and state-independent chrome only. The two state classes below are mutually exclusive, never layered on each
// other: Tailwind's emission order, not the attribute's, decides between two utilities of one property.
const card = `flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2 ${FOCUS_RING_CLASS.within}`;
const cardResting = 'border-line-control bg-paper';
const cardChosen = 'border-selected-edge bg-selected-fill';
const cardRefused = 'cursor-not-allowed';

/** "Who can see it": Public or Private. */
export const RecipeVisibilityField: FC<RecipeVisibilityFieldProps> = ({
    values,
    onChange,
    facts,
    heldVisibility: held,
    privateRefusal,
    onPremiumRequired,
    onConfirmPublic,
    onFreeASlot,
}) => {
    const { visibility: v } = useMessages(editorMessages);
    // Idempotent over a host that already passes the held value: the field enforces the rule rather than trusting it.
    const savedVisibility = heldVisibility(held, values.visibility);
    const { shown, options, slotsFull } = visibilityFieldOf({
        draft: values.visibility,
        saved: savedVisibility,
        facts,
        refusal: privateRefusal,
        messages: v,
    });

    const choose = (chosen: RecipeVisibility): void => {
        const next = visibilityChoice(shown, chosen, savedVisibility, facts);

        if (next === 'confirmPublic') {
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
                    const noteId = `${titleId}-note`;
                    // A refused card is described by its reason alone: the hint ("Anyone can find it in Discover") is not true of it.
                    const describedBy = option.refused
                        ? noteId
                        : [hintId, ...(option.note === undefined ? [] : [noteId])].join(' ');

                    return (
                        <label
                            key={option.value}
                            className={`${card} ${chosen ? cardChosen : cardResting} ${option.refused ? cardRefused : ''}`}
                        >
                            <input
                                type="radio"
                                name="recipe-visibility"
                                value={option.value}
                                checked={chosen}
                                onChange={() => choose(option.value)}
                                aria-labelledby={titleId}
                                aria-describedby={describedBy}
                                // Refused, not disabled: a natively disabled radio leaves the tab order and the reason with it.
                                aria-disabled={option.refused ? true : undefined}
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
                        </label>
                    );
                })}
            </div>
            {slotsFull === undefined ? null : (
                // ADR-0073: the refusal's ways forward. Premium is among them only where paid features are shown.
                <div role="group" aria-labelledby="recipe-visibility-ways" className="mt-1 flex flex-col gap-2">
                    <p id="recipe-visibility-ways" className="text-label text-ink">
                        {slotsFull.title}
                    </p>
                    {slotsFull.overLimit === undefined ? null : (
                        <div className="flex flex-col items-start gap-1">
                            <p className="text-meta text-ink-muted">{slotsFull.overLimit.text}</p>
                            {slotsFull.overLimit.premiumLink === undefined ? null : (
                                <button
                                    type="button"
                                    onClick={onPremiumRequired}
                                    className={`cursor-pointer text-meta font-semibold text-action underline ${FOCUS_RING_CLASS.offset}`}
                                >
                                    {slotsFull.overLimit.premiumLink}
                                </button>
                            )}
                        </div>
                    )}
                    <ul className="flex flex-col gap-2">
                        {slotsFull.ways.map((way) => (
                            <li key={way.id}>
                                <button
                                    type="button"
                                    onClick={way.id === 'premium' ? onPremiumRequired : onFreeASlot}
                                    className={`flex min-h-14 w-full cursor-pointer flex-col items-start justify-center rounded-lg border border-line-control bg-paper px-4 py-2 text-left ${FOCUS_RING_CLASS.offset}`}
                                >
                                    <span className="text-body font-semibold text-ink">{way.label}</span>
                                    <span className="text-meta text-ink-muted">{way.detail}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </fieldset>
    );
};
