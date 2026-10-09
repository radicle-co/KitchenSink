'use client';

/**
 * @module @commise/features-recipes — the web ingredient row the cook checks off (build spec §6.3).
 *
 * The WHOLE row is one checkbox — a `button` with `role="checkbox"` at least 48 px tall — named with the full line
 * (`ingredientRowName`), and described by the statuses it carries. Checked, the box fills with the signature motion and
 * the text dims to `inkMuted`: no strike-through, because a cook re-reads a checked amount and a strike-through damages
 * the word shape.
 *
 * The amount, the name, a variant's parts, the preparation, the notes and the badges are ONE flowing text block, so
 * at 320 px they break only at spaces and a badge wraps under the name (`namelessLineCopy.md` §2c).
 *
 * Presentational: props → JSX.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { CheckBoxGlyph } from '@commise/ui/check-box-glyph';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useId, type FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { IngredientCheckRowProps } from './cookRowProps.js';
import { ingredientRowName, ingredientRowStatuses } from './detailFacts.js';
import { isStandInName, lineDisplayName, variantPartTexts } from './lineName.js';
import { formatQuantity, isLineFoodRemoved } from './model.js';

/** The web checkable ingredient row. */
export const IngredientCheckRow: FC<IngredientCheckRowProps> = ({ ingredient, checked, allRemoved, onToggle }) => {
    const { detail, ingredientLineName, ingredientDetails } = useMessages(recipeMessages);
    const locale = useLocale();
    const statusId = useId();
    const amount = formatQuantity(ingredient.quantity, locale, ingredient.unit);
    const parts = variantPartTexts(ingredient.variant?.parts);
    const statuses = ingredientRowStatuses(ingredient, allRemoved, detail);

    return (
        <li>
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
                className="flex min-h-12 w-full items-start gap-3 rounded-md px-3 py-3 text-start transition hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
            >
                {/* The 24 px box and the text's 24 px first line start together, so the box is centred on that line. */}
                <CheckBoxGlyph checked={checked} />
                <span
                    data-line-text
                    className={`min-w-0 flex-1 break-words text-body transition-colors motion-reduce:transition-none ${checked ? 'text-ink-muted' : 'text-ink'}`}
                >
                    {amount !== '' && (
                        <>
                            <span className="text-figure-inline">{amount}</span>{' '}
                        </>
                    )}
                    {isStandInName(ingredient) ? (
                        <StandIn tone={isLineFoodRemoved(ingredient) ? 'caution' : 'neutral'}>
                            {lineDisplayName(ingredient, ingredientLineName)}
                        </StandIn>
                    ) : (
                        <span>{lineDisplayName(ingredient, ingredientLineName)}</span>
                    )}
                    {parts !== undefined && (
                        <span className="mt-1 block">
                            <VariantPartsLine parts={parts} tone="secondary" />
                        </span>
                    )}
                    {ingredient.preparation !== undefined && ingredient.preparation.length > 0 && (
                        <>
                            {' '}
                            <span className="text-ink-muted">{ingredient.preparation}</span>
                        </>
                    )}
                    {ingredient.notes !== undefined && ingredient.notes.length > 0 && (
                        <>
                            {' '}
                            <span className="text-meta text-ink-muted">{ingredient.notes}</span>
                        </>
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
