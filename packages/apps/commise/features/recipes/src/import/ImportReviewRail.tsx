'use client';

/**
 * @module @commise/features-recipes/import — `ImportReviewRail` (web): beside the review step at the wide container
 * class (1194 and web, board WizardStep), a navigation landmark over a window of the recipes to review. The current
 * recipe is marked `aria-current="step"`, filled and ringed in the selected edge (U10: the fill alone is 1.2:1); a
 * skipped one says so in its own name, not by look alone; under the list, how many recipes needed nothing and are
 * already in.
 *
 * Presentational: the host picks the window (never all of a long library) and opens a recipe. The native leaf is
 * `./ImportReviewRail.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { pluralOf } from '../format/plural.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { importMessages } from './messages.js';
import type { ImportReviewRailProps } from './props.js';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';

/** The review's recipe rail. */
export const ImportReviewRail: FC<ImportReviewRailProps> = ({
    total,
    recipes,
    currentId,
    addedWithoutStep,
    onOpenRecipe,
}) => {
    const { rail: r } = useMessages(importMessages).wizard;
    const locale = useLocale();

    return (
        <nav aria-label={r.label} className="flex flex-col gap-2">
            <p className="text-label text-ink-muted">{pluralOf(r.title, total, locale)}</p>
            <ul className="flex flex-col gap-1">
                {recipes.map((recipe) => {
                    const current = recipe.id === currentId;

                    return (
                        <li key={recipe.id}>
                            <button
                                type="button"
                                aria-current={current ? 'step' : undefined}
                                onClick={() => onOpenRecipe(recipe.id)}
                                className={`flex min-h-11 w-full items-center rounded-md px-3 py-1.5 text-left text-meta ${FOCUS_RING_CLASS.offset} ${
                                    current
                                        ? 'bg-selected-fill font-semibold text-ink ring-2 ring-inset ring-selected-edge'
                                        : 'text-ink'
                                }`}
                            >
                                <span className="min-w-0 break-words">
                                    {recipe.skipped ? fillTemplate(r.skipped, { recipe: recipe.title }) : recipe.title}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {addedWithoutStep > 0 ? (
                <p className="text-meta text-ink-muted">{pluralOf(r.rest, addedWithoutStep, locale)}</p>
            ) : null}
        </nav>
    );
};
