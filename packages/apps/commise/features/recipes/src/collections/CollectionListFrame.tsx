'use client';

/**
 * @module @commise/features-recipes — web collection-list FRAME (presentational).
 *
 * The chrome of the collection list — the heading and the create action — rendered OUTSIDE the list's suspense
 * boundary, which the composing container passes as `children`. A pending or failed read therefore swaps only what is
 * under the header, never the header itself. It fetches nothing.
 *
 * The heading takes focus when `headingFocusSignal` advances: a retry from the refresh notice (inside the boundary)
 * that succeeds removes the button the viewer pressed, and the container reports that across the boundary.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { CreateFab } from '@commise/ui/create-fab';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { SegmentedControl } from '@commise/ui/segmented-control';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { RECIPES_SEGMENTS, RECIPES_TITLE_ID } from '../list/model.js';
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
        <section aria-label={list.heading} className="mx-auto flex w-full max-w-page flex-col gap-4">
            {/* The Recipes screen's large title with Collections selected (slice 3, `buildSpec.md` §5.1). Below 840 the
                avatar is the action and "New collection" floats, right after the H1 in DOM order; from 840 the
                header's action is the New collection button and the sidebar holds the avatar. */}
            <LargeTitleHeader
                headingId={RECIPES_TITLE_ID}
                title={recipes.heading}
                focusSignal={headingFocusSignal}
                {...(headerAction === undefined ? {} : { action: headerAction })}
                afterTitle={
                    <>
                        <div className="hidden nav:block nav:flex-none">
                            <Button variant="secondary" icon="plus" onPress={onCreate}>
                                {list.createCta}
                            </Button>
                        </div>
                        <CreateFab label={list.createCta} icon="plus" onPress={onCreate} firstRun={firstRun} />
                    </>
                }
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
        </section>
    );
};
