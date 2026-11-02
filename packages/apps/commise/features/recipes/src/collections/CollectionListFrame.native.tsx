/**
 * @module @commise/features-recipes — native collection-list FRAME (presentational).
 *
 * The React Native leaf of `CollectionListFrame`: the large title (slice 3) and the floating "New collection", around
 * whatever the list's suspense boundary renders as `children`, so a pending or failed read never unmounts them. It
 * fetches nothing.
 *
 * The large title and the segments are not drawn here: the frame hands them to the one list below it through
 * `RecipeListHeaderContext` (the same slot the Recipes frame uses), and the list draws them as its first child. Collections
 * has no pinned field, so the whole header scrolls away with the content (designer finding C-2) and never unmounts when
 * the read changes state.
 *
 * When `headingFocusSignal` advances — a retry from the refresh notice inside the boundary succeeded and removed the
 * button the viewer pressed — the screen-reader cursor moves to the heading.
 */
import { useMessages } from '@commise/i18n/react';
import { CreateFab } from '@commise/ui/create-fab';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { SegmentedControl } from '@commise/ui/segmented-control';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { RECIPES_SEGMENTS, RECIPES_TITLE_ID } from '../list/model.js';
import { RecipeListHeaderContext } from '../list/recipeListHeaderContext.js';
import { recipeMessages } from '../messages.js';
import { collectionMessages } from './messages.js';
import type { CollectionListFrameProps } from './model.js';

export const CollectionListFrame: FC<CollectionListFrameProps> = ({
    onCreate,
    segments,
    headingFocusSignal,
    headerAction,
    createEntryYields = false,
    createFocusRequested = false,
    onCreateFocusHandled,
    children,
}) => {
    const { list } = useMessages(collectionMessages);
    const recipes = useMessages(recipeMessages).list;

    // The header is handed to the one list below (`RecipeListHeaderContext`), which draws it as its first child.
    const header = (
        // The Recipes screen's large title with Collections selected (slice 3, `buildSpec.md` §5.1): the avatar is its
        // action, and "New collection" floats over the screen's foot instead of sitting in the header.
        <LargeTitleHeader
            headingId={RECIPES_TITLE_ID}
            title={recipes.heading}
            focusSignal={headingFocusSignal}
            {...(headerAction === undefined ? {} : { action: headerAction })}
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
    );

    return (
        <View style={styles.container}>
            <RecipeListHeaderContext.Provider value={header}>
                <View style={styles.content}>{children}</View>
            </RecipeListHeaderContext.Provider>
            <CreateFab
                label={list.createCta}
                icon="plus"
                onPress={onCreate}
                yielded={createEntryYields}
                focusRequested={createFocusRequested}
                {...(onCreateFocusHandled === undefined ? {} : { onFocusRequestHandled: onCreateFocusHandled })}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, paddingTop: nativeTokens.spacing[2] },
    // The title insets its own sides and the list is full width, so each row of the list pads itself.
    content: { flex: 1 },
});
