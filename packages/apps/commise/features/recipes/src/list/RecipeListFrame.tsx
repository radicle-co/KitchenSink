'use client';

/**
 * @module @commise/features-recipes — the web My recipes FRAME (presentational,
 * `docs/design/uiOverhaul/buildSpec.md` §4.3).
 *
 * The chrome of the library — the heading, the My recipes · Collections segments and the search field — rendered
 * OUTSIDE the list's suspense boundary, which the composing container passes as `children`. A pending or failed read
 * therefore swaps only what is under the search field, never the field a cook is typing in. It fetches nothing.
 *
 * The search field is sticky at the top edge while the list scrolls on a narrow container, and hides on the first run
 * (the host decides when). The heading takes focus when `headingFocusSignal` advances: a retry from the refresh notice
 * (inside the boundary) that succeeds removes the button the cook pressed.
 *
 * The heading is the shell's `LargeTitleHeader` (slice 3), whose H1 takes focus when `headingFocusSignal` advances.
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { SearchField } from '@commise/ui/search-field';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useId, type FC } from 'react';

import { recipeMessages } from '../messages.js';
import { RECIPES_SEGMENTS, RECIPES_TITLE_ID, type RecipeListFrameProps, type RecipesSegment } from './model.js';

/**
 * Whether a segment id is one of the Recipes screen's places.
 *
 * @param id - The id the segmented control reports.
 * @returns `true` for `mine` or `collections`.
 */
function isRecipesSegment(id: string): id is RecipesSegment {
    return (RECIPES_SEGMENTS as readonly string[]).includes(id);
}

export const RecipeListFrame: FC<RecipeListFrameProps> = ({
    searchValue,
    onSearchChange,
    searchVisible,
    segments,
    headingFocusSignal,
    headerAction,
    children,
}) => {
    const { list } = useMessages(recipeMessages);
    const searchId = useId();

    return (
        <section aria-label={list.heading} className="mx-auto flex w-full max-w-page flex-col gap-4">
            {/* The large title (slice 3): "Recipes", the avatar as its action below 840, the segments under it. */}
            <LargeTitleHeader
                headingId={RECIPES_TITLE_ID}
                title={list.heading}
                focusSignal={headingFocusSignal}
                {...(headerAction === undefined ? {} : { action: headerAction })}
                {...(segments === undefined
                    ? {}
                    : {
                          segments: (
                              <SegmentedControl
                                  form="route"
                                  label={list.segmentsLabel}
                                  current={segments.current}
                                  segments={RECIPES_SEGMENTS.map((segment) => ({
                                      id: segment,
                                      label: segment === 'mine' ? list.tabMine : list.tabCollections,
                                      href: segments.href[segment],
                                  }))}
                                  onSelect={(id) => {
                                      if (isRecipesSegment(id)) {
                                          segments.onSelect(id);
                                      }
                                  }}
                              />
                          ),
                      })}
            />

            {searchVisible ? (
                <div data-sticky-search="" className="sticky top-0 z-10 -mx-1 bg-canvas px-1 py-2 @regular/main:static">
                    <SearchField
                        id={searchId}
                        label={list.searchLabel}
                        labelVisibility="hidden"
                        clearLabel={list.clearSearch}
                        placeholder={list.searchPlaceholder}
                        value={searchValue}
                        onChangeText={onSearchChange}
                    />
                </div>
            ) : null}

            {children}
        </section>
    );
};
