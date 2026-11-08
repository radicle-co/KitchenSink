'use client';

/**
 * @module @commise/features-recipes — the web recipe page's nutrition row (`nativeBoards/buildLists.md` item 12): the
 * mirror of `DetailNutritionSection.native.tsx`. A COLLAPSED disclosure reading "Nutrition" and "{n} cal per serving"
 * (or "Not counted yet"), which opens in place to the four figures, the caveats the stored figure carries and the notes
 * on where the numbers came from, with the link to the Data sources page. With nothing counted the figures are left
 * out, not drawn as dashes: the explanation lines say why.
 *
 * The heading holds the button (the disclosure pattern), so the section keeps its place in the outline and the button
 * carries `aria-expanded` and `aria-controls`. What the row shows is derived once, in `nutritionSectionFacts`, for both
 * platforms.
 *
 * Presentational: props → JSX. The disclosure state is the shell's.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { PRESS_FILL_CLASS } from '@commise/ui/surface-tone';
import { hasCatalogNutrition, hasUserEnteredIngredients } from '@kitchensink/recipe-core';
import Link from 'next/link';
import { useId, type ComponentProps, type FC } from 'react';

import { recipeMessages } from '../messages.js';
import { nutritionSectionFacts } from './detailFacts.js';
import { DETAIL_CARD } from './detailLayoutClasses.js';
import { NutritionFigure } from './NutritionFigure.js';
import type { RecipeDetailBodyProps } from './model.js';

/** A Next.js link target from a plain address. */
type Href = ComponentProps<typeof Link>['href'];

/** Props for {@link DetailNutritionSection}. */
export interface DetailNutritionSectionProps {
    readonly recipe: RecipeDetailBodyProps['recipe'];
    /** Whether the cook expanded the row. */
    readonly expanded: boolean;
    /** Flip the disclosure. */
    readonly onToggle: () => void;
    /** The Data sources page the source note links to; the link is left out without it. */
    readonly dataSourcesHref?: string;
}

/** The web nutrition section. */
export const DetailNutritionSection: FC<DetailNutritionSectionProps> = ({
    recipe,
    expanded,
    onToggle,
    dataSourcesHref,
}) => {
    const { detail } = useMessages(recipeMessages);
    const locale = useLocale();
    const panelId = useId();
    const { cells, summary, statusLine, rangeNotice, staleNotice, reviewNotice } = nutritionSectionFacts(
        recipe,
        detail,
        locale,
    );

    return (
        <section aria-label={detail.nutritionHeading} className={`@container/nutrition flex flex-col ${DETAIL_CARD}`}>
            <h2 id="nutrition" tabIndex={-1} className="text-section-title text-ink">
                <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={onToggle}
                    className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-4 text-start transition ${PRESS_FILL_CLASS.pointer} ${FOCUS_RING_CLASS.offset}`}
                >
                    <span className="flex flex-col">
                        <span className="text-section-title text-ink">{detail.nutritionTitle}</span>
                        <span className="text-meta font-normal text-ink-muted">{summary}</span>
                    </span>
                    <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={20} />
                </button>
            </h2>
            {expanded && (
                <div id={panelId} className="flex flex-col gap-3 px-4 pb-4">
                    {!cells.noneCounted && (
                        <dl className="grid grid-cols-2 gap-4 pt-2 @min-[35rem]/nutrition:grid-cols-4">
                            {cells.cells.map((cell) => (
                                <NutritionFigure key={cell.label} label={cell.label} value={cell.value} />
                            ))}
                        </dl>
                    )}
                    <div className="flex flex-col gap-1 text-caption text-ink-muted">
                        {statusLine !== undefined && <p>{statusLine}</p>}
                        {/* R38 and KTD-3b: two more admissions about the figures; both can be true at once. */}
                        {rangeNotice !== undefined && <p>{rangeNotice}</p>}
                        {staleNotice !== undefined && <p>{staleNotice}</p>}
                        {/* U14 — our own doubt, and actionable: re-pick the food. */}
                        {reviewNotice !== undefined && (
                            <p role="note" className="font-medium text-ink">
                                {reviewNotice}
                            </p>
                        )}
                        {hasCatalogNutrition(recipe.ingredients) && (
                            <p>
                                {detail.nutritionSourceNote}
                                {dataSourcesHref !== undefined && (
                                    <>
                                        {' '}
                                        <Link
                                            href={dataSourcesHref as Href}
                                            className="inline-block py-1 text-action-text underline underline-offset-2"
                                        >
                                            {detail.nutritionSourcesLink}
                                        </Link>
                                    </>
                                )}
                            </p>
                        )}
                        {hasUserEnteredIngredients(recipe.ingredients) && <p>{detail.nutritionCustomNote}</p>}
                    </div>
                </div>
            )}
        </section>
    );
};
