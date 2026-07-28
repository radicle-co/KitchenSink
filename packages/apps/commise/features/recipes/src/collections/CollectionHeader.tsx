/**
 * @module @commise/features-recipes — web collection-header view (W5 Task 6 building block).
 *
 * Presentational (pure props → JSX) render of the collection-view wireframe's header zone: the collection
 * name with its Edit/Delete affordances (C4), a visibility badge, the recipe count, source attribution for
 * a cloned collection, and its last-pulled date — plus the web-only Back affordance (C6). It fetches
 * nothing and performs no mutations; every interaction is delegated upward.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { collectionMessages } from './messages.js';
import { formatCollectionDate, type CollectionHeaderViewProps } from './model.js';

export const CollectionHeader: FC<CollectionHeaderViewProps> = ({
    name,
    description,
    visibility,
    recipeCount,
    sourceCollectionName,
    sourceOwnerHandle,
    lastPulledAt,
    onBack,
    onEdit,
    onDelete,
}) => {
    const { header, detail } = useMessages(collectionMessages);
    const locale = useLocale();

    const visibilityLabel = visibility === 'public' ? header.visibilityPublic : header.visibilityPrivate;
    const recipeCountLabel = formatRecipeCount(
        recipeCount,
        { one: header.recipeCountOne, other: header.recipeCountOther },
        locale,
    );
    // FR-011 — attribution is shown only for a cloned collection (`sourceCollectionName` present); the
    // source owner handle may still be unresolved, in which case the template drops the `@handle` segment
    // rather than rendering a broken/partial mention.
    const sourceAttribution =
        sourceCollectionName === undefined
            ? undefined
            : sourceOwnerHandle === undefined
              ? fillTemplate(header.sourceAttributionNoHandle, { name: sourceCollectionName })
              : fillTemplate(header.sourceAttribution, { handle: sourceOwnerHandle, name: sourceCollectionName });
    const lastPulledLabel =
        lastPulledAt === undefined
            ? undefined
            : fillTemplate(header.lastPulled, { date: formatCollectionDate(lastPulledAt, locale) });

    return (
        <header aria-label={name} className="flex flex-col gap-3">
            {onBack !== undefined && (
                <button
                    type="button"
                    onClick={onBack}
                    className="self-start text-body-sm font-medium text-seafoam transition hover:underline"
                >
                    <span aria-hidden="true">{'‹ '}</span>
                    {header.backToCollections}
                </button>
            )}
            <div className="flex items-center justify-between gap-4">
                {/* `min-w-0 break-words` + the actions' `shrink-0`: a flex item's default `min-width: auto`
                    lets a long, unbroken collection name overflow the row and crowd the actions out. The
                    native leaf carries the same contract via `flexShrink` (where RN's 0 default made this a
                    hard on-device failure — Rename clipped, Delete off-screen entirely). */}
                <h1 className="min-w-0 break-words font-display text-display-md font-bold text-charcoal">{name}</h1>
                <div className="flex shrink-0 items-center gap-3">
                    <button
                        type="button"
                        onClick={onEdit}
                        className="rounded-full px-4 py-2 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/10"
                    >
                        {detail.renameCta}
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        className="rounded-full px-4 py-2 text-body-sm font-medium text-error transition hover:bg-coral/10"
                    >
                        {detail.deleteCta}
                    </button>
                </div>
            </div>
            {description !== undefined && description.length > 0 && (
                <p className="text-body-lg text-slate">{description}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-slate">
                <span className="rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-seafoam">
                    {visibilityLabel}
                </span>
                <span>{recipeCountLabel}</span>
            </div>
            {sourceAttribution !== undefined && <p className="text-body-sm text-slate">{sourceAttribution}</p>}
            {lastPulledLabel !== undefined && <p className="text-body-sm text-slate">{lastPulledLabel}</p>}
        </header>
    );
};
