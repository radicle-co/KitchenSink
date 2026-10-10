/**
 * @module @commise/features-recipes — native collection-list FRAME (presentational).
 *
 * The React Native leaf of `CollectionListFrame`: the large title (slice 3) and the floating "New collection", around
 * whatever the list's suspense boundary renders as `children`, so a pending or failed read never unmounts them. It
 * fetches nothing.
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
import { recipeMessages } from '../messages.js';
import { collectionMessages } from './messages.js';
import type { CollectionListFrameProps } from './model.js';

export const CollectionListFrame: FC<CollectionListFrameProps> = ({
    onCreate,
    segments,
    headingFocusSignal,
    headerAction,
    firstRun = false,
    children,
}) => {
    const { list } = useMessages(collectionMessages);
    const recipes = useMessages(recipeMessages).list;

    return (
        <View style={styles.container}>
            {/* The Recipes screen's large title with Collections selected (slice 3, `buildSpec.md` §5.1): the avatar
                is its action, and "New collection" floats over the screen's foot instead of sitting in the header. */}
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
            {children}
            <CreateFab label={list.createCta} icon="plus" onPress={onCreate} firstRun={firstRun} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[2],
    },
});
