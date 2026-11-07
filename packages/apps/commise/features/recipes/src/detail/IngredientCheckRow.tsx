'use client';

/**
 * @module @commise/features-recipes — the web ingredient row the cook checks off (build spec §6.3).
 *
 * The WHOLE row is one checkbox — a `button` with `role="checkbox"` at least 44 px tall — named with the full line
 * (`ingredientRowName`), and described by the statuses it carries. Checked, the box fills with the signature motion and
 * the text dims to `inkMuted`: no strike-through, because a cook re-reads a checked amount and a strike-through damages
 * the word shape.
 *
 * The amount, the name, a variant's parts, the preparation, the notes and the badges are ONE flowing text block, so
 * at 320 px they break only at spaces and a badge wraps under the name (`namelessLineCopy.md` §2c). A stand-in is a
 * chip, not text, so its amount (or a lone unit) is a line of its own above it (`designAnswers.md` #144 item 12).
 *
 * Presentational: props → JSX.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { CheckBoxGlyph } from '@commise/ui/check-box-glyph';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { PRESS_FILL_CLASS } from '@commise/ui/surface-tone';
import { useId, type FC } from 'react';

import { PrepJoin } from '../format/PrepJoin.js';
import { recipeMessages } from '../messages.js';
import type { IngredientCheckRowProps } from './cookRowProps.js';
import { ingredientRowName, ingredientRowStatuses } from './detailFacts.js';
import { isStandInName, lineAmountName, lineDisplayName, variantPartTexts } from './lineName.js';
import { formatAmount, isLineFoodRemoved } from './model.js';

/**
 * A hairline above a row, inset to where its text starts (the 16 gutter, the 18 box, a 12 gap): drawn on the `li`, so it is
 * the row's own and never the list's. Written whole, for Tailwind.
 */
const DIVIDED_ROW =
    'relative before:absolute before:end-0 before:start-[46px] before:top-0 before:h-px before:bg-line-divider';

/** The web checkable ingredient row. */
export const IngredientCheckRow: FC<IngredientCheckRowProps> = ({
    ingredient,
    checked,
    allRemoved,
    onToggle,
    divided = false,
}) => {
    const { detail, ingredientLineName, ingredientDetails } = useMessages(recipeMessages);
    const locale = useLocale();
    const statusId = useId();
    const amount = formatAmount(ingredient.quantity, locale, ingredient.unit);
    const parts = variantPartTexts(ingredient.variant?.parts);
    const statuses = ingredientRowStatuses(ingredient, allRemoved, detail);
    const standIn = isStandInName(ingredient);
    // The preparation, then the notes override: the muted tail after the name. Its first part is joined with " · ".
    const tail = [ingredient.preparation, ingredient.notes].filter(
        (part): part is string => part !== undefined && part.length > 0,
    );
    const amountFigure = <span className="font-semibold tabular-nums lining-nums">{amount}</span>;

    return (
        <li className={divided ? DIVIDED_ROW : undefined}>
            <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={ingredientRowName(
                    ingredient,
                    locale,
                    ingredientLineName,
                    ingredientDetails.checkLabelWithDetails,
                )}
                aria-describedby={statuses.length > 0 ? statusId : undefined}
                onClick={() => onToggle(ingredient.ingredientId)}
                className={`flex min-h-11 w-full items-start gap-3 rounded-md px-4 py-2 text-start transition ${PRESS_FILL_CLASS.pointer} ${FOCUS_RING_CLASS.inset}`}
            >
                {/* The 18 px box is centred in a box as tall as the text's 24 px first line (`body`), so it follows the line. */}
                <span className="flex h-6 items-center">
                    <CheckBoxGlyph checked={checked} />
                </span>
                <span
                    data-line-text
                    className={`min-w-0 flex-1 break-words text-body transition-colors motion-reduce:transition-none ${checked ? 'text-ink-muted' : 'text-ink'}`}
                >
                    {/* A stand-in is a chip, not text: its amount (or a lone unit) is the line above it, never on the
                        chip's line (designAnswers.md #144 item 12). */}
                    {amount !== '' && (standIn ? <span className="block">{amountFigure}</span> : <>{amountFigure} </>)}
                    {standIn ? (
                        <StandIn tone={isLineFoodRemoved(ingredient) ? 'caution' : 'neutral'}>
                            {lineDisplayName(ingredient, ingredientLineName)}
                        </StandIn>
                    ) : (
                        <span>
                            {lineAmountName(ingredient, ingredient.quantity, ingredient.unit, ingredientLineName)}
                        </span>
                    )}
                    {parts !== undefined && (
                        <span className="mt-1 block">
                            <VariantPartsLine parts={parts} tone="secondary" />
                        </span>
                    )}
                    {tail.map((part, index) =>
                        index === 0 ? (
                            <PrepJoin key={part}>{part}</PrepJoin>
                        ) : (
                            <span key={part}>
                                {' '}
                                <span className="text-ink-muted">{part}</span>
                            </span>
                        ),
                    )}
                    {statuses.length > 0 && (
                        <span id={statusId}>
                            {statuses.map((status) => (
                                <span key={status.text}>
                                    {' '}
                                    <StatusBadge status={status.tone}>{status.text}</StatusBadge>
                                </span>
                            ))}
                        </span>
                    )}
                </span>
            </button>
        </li>
    );
};
