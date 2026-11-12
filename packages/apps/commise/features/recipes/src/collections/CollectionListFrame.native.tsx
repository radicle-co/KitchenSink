/**
 * @module @commise/features-recipes — native collection-list FRAME (presentational).
 *
 * The React Native leaf of `CollectionListFrame`: the large title (slice 3) and the floating "New collection", around
 * whatever the list's suspense boundary renders as `children`, so a pending or failed read never unmounts them. It
 * fetches nothing.
 *
 * The large title and the segments are not drawn here: the frame hands them to the one list below it through
 * `RecipeListHeaderContext` (the same slot the Recipes frame uses), and the list draws them as its first child, so they
 * scroll away with the content (designer finding C-2) and never unmount when the read changes state. The search field is the
 * one thing that stays (designer ruling 2026-11-02): where the list has one it is drawn ONCE here, over a spacer the header
 * holds, slides with the scroll and pins at the top on a band, through `@commise/ui/pinned-search`, the same parts the Recipes
 * frame uses.
 *
 * When `headingFocusSignal` advances — a retry from the refresh notice inside the boundary succeeded and removed the
 * button the viewer pressed — the screen-reader cursor moves to the heading.
 */
import { useMessages } from '@commise/i18n/react';
import { CreateFab } from '@commise/ui/create-fab';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { PinnedSearchOverlay, PinnedSearchSpacer, usePinnedSearch } from '@commise/ui/pinned-search';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useId, type FC } from 'react';

import { RECIPES_SEGMENTS, RECIPES_TITLE_ID } from '../list/model.js';
import { RecipeListHeaderContext } from '../list/recipeListHeaderContext.js';
import { FillBox, HEADER_TOP_PX, ListHeaderBox, ListHeaderGroup } from '../list/RecipeListLayout.native.js';
import { recipeMessages } from '../messages.js';
import { collectionMessages } from './messages.js';
import type { CollectionListFrameProps } from './model.js';

export const CollectionListFrame: FC<CollectionListFrameProps> = ({
    onCreate,
    segments,
    headingFocusSignal,
    createEntryYields = false,
    search,
    createFocusRequested = false,
    onCreateFocusHandled,
    children,
}) => {
    const { list } = useMessages(collectionMessages);
    const recipes = useMessages(recipeMessages).list;
    const searchId = useId();
    const pin = usePinnedSearch(search?.value ?? '', HEADER_TOP_PX);
    const searchVisible = search?.visible === true;

    // The header is handed to the one list below (`RecipeListHeaderContext`), which draws it as its first child.
    const header = (
        <ListHeaderBox>
            <ListHeaderGroup>
                {/* The Recipes screen's large title with Collections selected (slice 3, `buildSpec.md` §5.1): the avatar is its
        // action, and "New collection" floats over the screen's foot instead of sitting in the header. */}
                <LargeTitleHeader
                    headingId={RECIPES_TITLE_ID}
                    title={recipes.heading}
                    focusSignal={headingFocusSignal}
                    {...(segments === undefined
                        ? {}
                        : {
                              segments: (
                                  <SegmentedControl
                                      form="route"
                                      width="adaptive"
                                      label={recipes.segmentsLabel}
                                      current={segments.current}
                                      segments={RECIPES_SEGMENTS.map((segment) => ({
                                          id: segment,
                                          label: segment === 'mine' ? recipes.tabMine : recipes.tabCollections,
                                          href: segments.href[segment],
                                      }))}
                                      onSelect={(id) => {
                                          const segment = RECIPES_SEGMENTS.find((candidate) => candidate === id);

                                          if (segment !== undefined) {
                                              segments.onSelect(segment);
                                          }
                                      }}
                                  />
                              ),
                          })}
                />
                {searchVisible ? <PinnedSearchSpacer pin={pin} label={list.searchLabel} compact={false} /> : null}
            </ListHeaderGroup>
        </ListHeaderBox>
    );

    return (
        <FillBox>
            <RecipeListHeaderContext.Provider value={header}>
                <FillBox>{children}</FillBox>
            </RecipeListHeaderContext.Provider>
            {searchVisible ? (
                <PinnedSearchOverlay
                    pin={pin}
                    field={{
                        id: searchId,
                        label: list.searchLabel,
                        labelVisibility: 'hidden',
                        clearLabel: list.clearSearch,
                        placeholder: list.searchLabel,
                        value: search?.value ?? '',
                        onChangeText: search?.onChange ?? noop,
                    }}
                />
            ) : null}
            <CreateFab
                label={list.createCta}
                icon="plus"
                onPress={onCreate}
                yielded={createEntryYields}
                focusRequested={createFocusRequested}
                {...(onCreateFocusHandled === undefined ? {} : { onFocusRequestHandled: onCreateFocusHandled })}
            />
        </FillBox>
    );
};

/** A no-op: the field's change handler when the host passed no search (the overlay is not drawn then). */
const noop = (): void => undefined;
