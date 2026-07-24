/**
 * @module @commise/features-recipes — web clone-info panel (W5 Task 8 building block).
 *
 * Presentational (pure props → JSX) render of the collection-view wireframe's "CLONE INFO" panel (C5): the
 * source collection's `@owner / "name"` attribution, the date this collection was cloned, and a View Source
 * control. Rendered by the composing container ONLY when the collection is a clone (W5 Task 12) — this leaf
 * assumes it is always given clone props and holds no "not a clone" branch of its own. It fetches nothing
 * and performs no mutations; the View Source interaction is delegated upward.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import { formatCollectionDate, type CloneInfoPanelProps } from './model.js';

export const CloneInfoPanel: FC<CloneInfoPanelProps> = ({
    sourceOwnerHandle,
    sourceCollectionName,
    sourceCollectionId,
    clonedAt,
    locale,
    onViewSource,
}) => {
    const { cloneInfo } = useMessages(collectionMessages);

    // `sourceCollectionName`/`sourceOwnerHandle` are frozen at clone time and may independently be absent
    // (unresolved owner, or a source deleted after cloning) — the attribution degrades name-only, then to a
    // generic fallback, rather than leaking `undefined` into the DOM (mirrors CollectionHeader's
    // `sourceAttribution`/`sourceAttributionNoHandle` handling of the same provenance fields).
    const attribution =
        sourceCollectionName === undefined
            ? cloneInfo.clonedFromUnknown
            : sourceOwnerHandle === undefined
              ? fillTemplate(cloneInfo.clonedFromNoHandle, { name: sourceCollectionName })
              : fillTemplate(cloneInfo.clonedFrom, { handle: sourceOwnerHandle, name: sourceCollectionName });
    const clonedOnLabel = fillTemplate(cloneInfo.clonedOn, { date: formatCollectionDate(clonedAt, locale) });

    return (
        <section aria-label={cloneInfo.heading} className="flex flex-col gap-2 rounded-2xl bg-card p-5 shadow-sm">
            <h2 className="text-caption font-semibold uppercase tracking-wide text-slate">{cloneInfo.heading}</h2>
            <p className="text-body-sm text-charcoal">{attribution}</p>
            <p className="text-body-sm text-slate">{clonedOnLabel}</p>
            <button
                type="button"
                onClick={() => onViewSource(sourceCollectionId)}
                className="self-start rounded-full px-4 py-2 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/10"
            >
                {cloneInfo.viewSource}
            </button>
        </section>
    );
};
