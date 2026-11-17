'use client';

/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (web): "Who can see it"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.7 item 2), a radio group of two cards, Public and Private.
 *
 * Every recipe offers Private (ADR-0073). Private
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
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { RecipeVisibility as RecipeVisibilityValue, type RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { heldVisibility } from '../actions/privateGate.js';
import { editorMessages } from '../editor/messages.js';
import { visibilityChoice, visibilityFieldOf, type RecipeVisibilityFieldProps } from './props.js';

// Layout and state-independent chrome only. The two state classes below are mutually exclusive, never layered on each
// other: Tailwind's emission order, not the attribute's, decides between two utilities of one property.
const card = `flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2 ${FOCUS_RING_CLASS.within}`;
const cardResting = 'border-line-control bg-paper';
const cardChosen = 'border-selected-edge bg-selected-fill';
// A card that cannot be chosen LOOKS it (the design system's disabled treatment, as `RadioList` and `Button` draw it): a muted
// border, a dimmed radio and title. Its reason is not dimmed: it is the one thing on the card that must stay readable.
const cardRefused = 'cursor-not-allowed';
const cardRefusedEdge = 'border-line-divider bg-paper';
const dimmed = 'opacity-60';
const confirmLineId = 'recipe-visibility-confirm-line';

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
    webSource,
    publicHeld,
    confirmLine: confirmText,
    focusSignal = 0,
}) => {
    const { visibility: v } = useMessages(editorMessages);
    const group = useFocusOnSignal<HTMLFieldSetElement>(focusSignal);
    // Idempotent over a host that already passes the held value: the field enforces the rule rather than trusting it.
    const savedVisibility = heldVisibility(held, values.visibility);
    const { shown, options, slotsFull, confirmLine } = visibilityFieldOf({
        draft: values.visibility,
        saved: savedVisibility,
        facts,
        refusal: privateRefusal,
        messages: v,
        ...(webSource === undefined ? {} : { webSource }),
        ...(publicHeld === undefined ? {} : { publicHeld }),
        ...(confirmText === undefined ? {} : { confirmLine: confirmText }),
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
        // Focusable by script only (`tabIndex={-1}`): after a Remove the group is the next thing to read, and the held note with it.
        <fieldset ref={group} tabIndex={-1} className={`flex flex-col gap-2 ${FOCUS_RING_CLASS.offset}`}>
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
                        : [
                              hintId,
                              ...(option.note === undefined ? [] : [noteId]),
                              ...(option.value === RecipeVisibilityValue.PUBLIC && confirmLine !== undefined
                                  ? [confirmLineId]
                                  : []),
                          ].join(' ');

                    return (
                        <label
                            key={option.value}
                            className={`${card} ${option.refused ? `${cardRefusedEdge} ${cardRefused}` : chosen ? cardChosen : cardResting}`}
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
                                className={`size-5 shrink-0 accent-action ${option.refused ? dimmed : ''}`}
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span
                                    id={titleId}
                                    className={`text-body font-semibold text-ink ${option.refused ? dimmed : ''}`}
                                >
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
            {confirmLine === undefined ? null : (
                // ADR-0095: said before the cook chooses Public (WCAG 3.2.2); it describes the Public radio.
                <p id={confirmLineId} className="text-meta text-ink-muted">
                    {confirmLine}
                </p>
            )}
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
