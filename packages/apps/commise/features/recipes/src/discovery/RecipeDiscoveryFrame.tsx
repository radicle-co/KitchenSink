'use client';

/**
 * @module @commise/features-recipes — web discovery FRAME (presentational, T076 / US2).
 *
 * The chrome of public discovery — heading, source switcher, search field with its recent-search panel, filter slot,
 * back-to-browse and sort — rendered OUTSIDE the discovery suspense boundary, which the composing container passes as
 * `children`. A pending or failed search therefore swaps only the results, never the field a viewer is typing in. It
 * fetches nothing.
 *
 * It also holds the region that announces settled results. The region is mounted empty with the frame and outlives
 * every body the boundary swaps in (loading, error, no-match, results), because a live region that mounts with its text
 * already inside is not reliably announced. Its text is the results header's own sentence, so identical results stay
 * silent; nothing is announced when a search starts. On a successful server prefetch the region ships its text in the
 * HTML, which is correct: a page load should not announce its own results, and the first change after that does.
 *
 * The one piece of local state is `searchFocused` — pure UI — because the recent-search panel (U7) is an IDLE-state
 * affordance: it appears only while focus is inside the search area and nothing is searched. The history behind it
 * belongs to the container's `useRecentSearches`.
 *
 * The heading takes focus when `headingFocusSignal` advances: a retry from the results' refresh notice (inside the
 * boundary) that succeeds removes the button the viewer pressed, and the container reports that across the boundary.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { useState } from 'react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { RecipeSourceTabs } from '../list/RecipeSourceTabs.js';
import { discoveryMessages } from './messages.js';
import {
    DISCOVERY_SORTS,
    discoverySortLabel,
    formatDiscoveryResultsSummary,
    type RecipeDiscoveryFrameProps,
} from './model.js';

export const RecipeDiscoveryFrame: FC<RecipeDiscoveryFrameProps> = ({
    searchValue,
    onSearchChange,
    searching,
    headingFocusSignal,
    resultsSummary,
    tab,
    recentSearches,
    filterSlot,
    sort,
    onExitToBrowse,
    children,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();
    const headingRef = useFocusOnSignal<HTMLHeadingElement>(headingFocusSignal);

    // Local UI state ONLY: whether focus is inside the search area. The recent searches are an idle-state shortcut, so
    // they appear on focus and vanish once focus leaves — they must never sit permanently above the results.
    const [searchFocused, setSearchFocused] = useState(false);
    // Idle + focused + something to offer. Gate on `!searching`, not on the query alone: a filter applied from the
    // sheet leaves the query blank, so checking only the field kept this idle-only panel drawn over the result list.
    const showRecentSearches =
        recentSearches !== undefined && recentSearches.queries.length > 0 && searchFocused && !searching;

    return (
        <section aria-label={discovery.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            <header>
                <h1 ref={headingRef} tabIndex={-1} className="font-display text-display-md font-bold text-charcoal">
                    {discovery.heading}
                </h1>
            </header>
            {/* L5 — the source switcher, in the SAME position (under the heading, above the search field) and from the
                SAME component the personal library uses. It is the way BACK: without it a viewer who chose "Community"
                on `/recipes` had no route home short of the browser's Back button. */}
            {tab !== undefined && <RecipeSourceTabs tab={tab} />}
            {/* The field + its recent-search panel form ONE focus scope: `focusout` bubbles here carrying the element
                focus is moving TO, so a click that moves focus INTO the panel keeps it mounted long enough to land. */}
            <div
                className="flex flex-col gap-2"
                onFocus={() => setSearchFocused(true)}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                        setSearchFocused(false);
                    }
                }}
            >
                <input
                    type="search"
                    aria-label={discovery.searchLabel}
                    placeholder={discovery.searchPlaceholder}
                    value={searchValue}
                    onChange={(event) => onSearchChange(event.target.value)}
                    // Placeholder text is TEXT: `placeholder:text-slate`, never `mist` (palette JSDoc, `@commise/ui`'s
                    // `tokens/colors.ts`). The `border-border` hairline stays `mist`-derived.
                    className="w-full rounded-full border border-border bg-card px-5 py-3 text-body-md text-charcoal shadow-sm outline-none placeholder:text-slate focus:ring-2 focus:ring-seafoam"
                />
                {showRecentSearches && (
                    <section
                        aria-label={discovery.recentSearchesLabel}
                        className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-caption font-semibold uppercase tracking-wide text-slate">
                                {discovery.recentSearchesLabel}
                            </p>
                            <button
                                type="button"
                                aria-label={discovery.clearRecentSearchesLabel}
                                onClick={recentSearches.onClear}
                                // Touch floor `min-h-11` (44px) at base — the native leaf carries the same 44pt floor —
                                // reset at `md:` so the desktop density of this small header control is unchanged.
                                className="inline-flex min-h-11 items-center rounded-full px-2 py-1 text-caption font-semibold text-ocean-dark transition hover:bg-mist/20 md:min-h-0"
                            >
                                {discovery.clearRecentSearches}
                            </button>
                        </div>
                        <ul className="flex flex-col">
                            {recentSearches.queries.map((query) => (
                                <li key={query}>
                                    <button
                                        type="button"
                                        aria-label={fillTemplate(discovery.recentSearchLabel, { query })}
                                        onClick={() => recentSearches.onSelect(query)}
                                        className="inline-flex min-h-11 w-full items-center rounded-lg px-2 py-2 text-left text-body-sm text-charcoal transition hover:bg-pearl md:min-h-0"
                                    >
                                        {query}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
            {filterSlot}
            {onExitToBrowse !== undefined && (
                <button
                    type="button"
                    onClick={onExitToBrowse}
                    className="inline-flex min-h-11 items-center self-start rounded-full px-3 py-1 text-body-sm font-semibold text-ocean-dark transition hover:bg-mist/20 md:min-h-0"
                >
                    {discovery.backToBrowse}
                </button>
            )}
            {sort !== undefined && (
                <div role="radiogroup" aria-label={discovery.sortLabel} className="flex flex-wrap gap-2">
                    {DISCOVERY_SORTS.map((option) => {
                        const checked = sort.active === option;

                        return (
                            <button
                                key={option}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                onClick={() => sort.onChange(option)}
                                // Touch floor `min-h-11` at base, reset at `md:` — the same treatment the list's facet
                                // chips and the native leaf's `styles.sortChip` (`minHeight: 44`) carry.
                                className={`inline-flex min-h-11 items-center rounded-full px-3 py-1 text-body-sm font-medium transition md:min-h-0 ${
                                    checked ? 'bg-charcoal text-white' : 'bg-pearl text-slate hover:bg-mist/40'
                                }`}
                            >
                                {discoverySortLabel(option, discovery)}
                            </button>
                        );
                    })}
                </div>
            )}
            {/* Visually hidden, so it takes no place in the gap. */}
            <p role="status" className="sr-only">
                {resultsSummary === undefined ? '' : formatDiscoveryResultsSummary(resultsSummary, discovery, locale)}
            </p>
            {children}
        </section>
    );
};
