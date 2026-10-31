'use client';

/**
 * @module @commise/features-recipes — web discovery FRAME (presentational, T076 / US2; slice 5 of the UI overhaul).
 *
 * The chrome of public discovery, rendered OUTSIDE the discovery suspense boundary, which the composing container passes as
 * `children`: the large title, the search field with its recent-search panel, the filters, back-to-browse, the sort, and
 * the count line (`docs/design/uiOverhaul/buildSpec.md` §3.3, §4.4, §4.5). A pending or failed search therefore swaps only
 * the results, never the field a viewer is typing in. It fetches nothing.
 *
 * The filters arrive in the ONE presentation the container decided: a sticky panel beside the results (the search field,
 * count and results then share the column to its right), or a Filters button with the sort, the applied-filter chips and
 * the sheet — so the facets exist exactly once.
 *
 * The two presentations are ONE tree: the search field, the count line and `children` keep their parent and index in
 * both, and only the slots around them fill or empty. The presentation follows `<main>`'s measured width, so it switches
 * right after the first paint on a wide screen and on every resize across the breakpoint. Drawn as two trees, each switch
 * remounted the field (focus and the recent-search panel gone), the live region (remounted with its text inside) and the
 * whole results body (every rail back at its start). The sort moves between the Filters row and the count line, so it
 * alone remounts; a sort menu held open through a resize closes. `RecipeDiscoveryContainer.layoutSwitch.test.tsx` and
 * this frame's "switching between the sheet and the panel" tests hold it.
 *
 * The count line is one element that is both the visible "12 recipes for “lamb”" and the polite live region that announces
 * it. It is mounted empty with the frame and outlives every body the boundary swaps in (loading, error, no-result,
 * results), because a live region that mounts with its text already inside is not reliably announced. Identical results
 * stay silent; nothing is announced when a search starts. On a successful server prefetch it ships its text in the HTML,
 * which is correct: a page load should not announce its own results, and the first change after that does.
 *
 * The one piece of local state is `searchFocused` — pure UI — because the recent-search panel (U7) is an IDLE-state
 * affordance: it appears only while focus is inside the search area and nothing is searched. The history behind it
 * belongs to the container's `useRecentSearches`. The heading takes focus when `headingFocusSignal` advances: a retry from
 * the results' refresh notice (inside the boundary) that succeeds removes the button the viewer pressed, and the container
 * reports that across the boundary.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { SearchField } from '@commise/ui/search-field';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { surfaceToneClass, PRESS_FILL_CLASS } from '@commise/ui/surface-tone';
import { useState } from 'react';
import type { FC, ReactNode } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { DiscoverySortMenu } from './DiscoverySortMenu.js';
import { discoveryMessages } from './messages.js';
import {
    DISCOVER_SEARCH_ID,
    DISCOVER_TITLE_ID,
    formatDiscoveryResultsSummary,
    type RecipeDiscoveryFrameProps,
} from './model.js';

export const RecipeDiscoveryFrame: FC<RecipeDiscoveryFrameProps> = ({
    searchValue,
    onSearchChange,
    searching,
    headingFocusSignal,
    resultsSummary,
    headerAction,
    recentSearches,
    filters,
    sort,
    onExitToBrowse,
    children,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();

    // Local UI state ONLY: whether focus is inside the search area. The recent searches are an idle-state shortcut, so
    // they appear on focus and vanish once focus leaves — they must never sit permanently above the results.
    const [searchFocused, setSearchFocused] = useState(false);
    // Idle + focused + something to offer. Gate on `!searching`, not on the query alone: a filter applied from the sheet
    // leaves the query blank, so checking only the field kept this idle-only panel drawn over the result list.
    const showRecentSearches =
        recentSearches !== undefined && recentSearches.queries.length > 0 && searchFocused && !searching;

    const sheet = filters?.presentation === 'sheet' ? filters : undefined;
    const panel = filters?.presentation === 'panel' ? filters : undefined;
    const sortControl = sort === undefined ? null : <DiscoverySortMenu active={sort.active} onChange={sort.onChange} />;

    // The field + its recent-search panel form ONE focus scope: `focusout` bubbles here carrying the element focus is
    // moving TO, so a click that moves focus INTO the panel keeps it mounted long enough to land.
    const searchBlock: ReactNode = (
        <div
            className="flex flex-col gap-2"
            onFocus={() => setSearchFocused(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    setSearchFocused(false);
                }
            }}
        >
            <SearchField
                id={DISCOVER_SEARCH_ID}
                label={discovery.searchLabel}
                labelVisibility="hidden"
                clearLabel={discovery.clearSearch}
                placeholder={discovery.searchPlaceholder}
                value={searchValue}
                onChangeText={onSearchChange}
            />
            {showRecentSearches && (
                <section
                    aria-label={discovery.recentSearchesLabel}
                    className={`flex flex-col gap-2 rounded-md border border-line-divider ${surfaceToneClass('paper')} p-3 shadow-sm`}
                >
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-label text-ink-muted">{discovery.recentSearchesLabel}</p>
                        <Button
                            variant="ghost"
                            size="sm"
                            accessibilityLabel={discovery.clearRecentSearchesLabel}
                            onPress={recentSearches.onClear}
                        >
                            {discovery.clearRecentSearches}
                        </Button>
                    </div>
                    <ul className="flex flex-col">
                        {recentSearches.queries.map((query) => (
                            <li key={query}>
                                <button
                                    type="button"
                                    aria-label={fillTemplate(discovery.recentSearchLabel, { query })}
                                    onClick={() => recentSearches.onSelect(query)}
                                    className={`inline-flex min-h-11 w-full items-center rounded-md px-2 text-start text-body text-ink ${PRESS_FILL_CLASS.pointer} ${FOCUS_RING_CLASS.offset}`}
                                >
                                    {query}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );

    const backToBrowse =
        onExitToBrowse === undefined ? null : (
            <div>
                <Button variant="ghost" size="sm" icon="chevronLeft" onPress={onExitToBrowse}>
                    {discovery.backToBrowse}
                </Button>
            </div>
        );

    // Mounted empty and never unmounted by a body swap: this is the live region. When nothing was found the no-result
    // heading below already shows the same sentence, so the line keeps ANNOUNCING it but stops showing it.
    const count = (
        <p
            role="status"
            className={`min-w-0 text-meta text-ink-muted tabular-nums lining-nums${resultsSummary?.count === 0 ? ' sr-only' : ''}`}
        >
            {resultsSummary === undefined ? '' : formatDiscoveryResultsSummary(resultsSummary, discovery, locale)}
        </p>
    );

    return (
        <section aria-label={discovery.heading} className="mx-auto flex w-full max-w-page flex-col gap-4">
            <LargeTitleHeader
                headingId={DISCOVER_TITLE_ID}
                title={discovery.heading}
                focusSignal={headingFocusSignal}
                {...(headerAction === undefined ? {} : { action: headerAction })}
            />
            {/* ONE tree for both presentations, with a fixed slot for each part: the presentation follows <main>'s
                measured width, so it changes after the first paint and on every resize across the breakpoint. A part
                that moved to another parent would be a new element each time (focus lost, a rail's scroll reset, the
                live region remounted with its text inside), so only the slots' contents and the row's direction change. */}
            <div className={panel === undefined ? 'flex flex-col gap-4' : 'flex items-start gap-6'}>
                {panel?.panel}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    {searchBlock}
                    {sheet === undefined ? null : (
                        <>
                            <div className="flex items-center justify-between gap-3">
                                {sheet.trigger}
                                {sortControl}
                            </div>
                            {sheet.applied}
                            {sheet.sheet}
                        </>
                    )}
                    {filters === undefined ? sortControl : null}
                    {backToBrowse}
                    <div className="flex items-center justify-between gap-3">
                        {count}
                        {panel === undefined ? null : sortControl}
                    </div>
                    {children}
                </div>
            </div>
        </section>
    );
};
