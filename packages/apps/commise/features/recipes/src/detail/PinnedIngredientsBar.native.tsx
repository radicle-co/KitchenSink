'use client';

/**
 * @module @commise/features-recipes — the native pinned ingredients bar and the list it opens (owner ruling R1,
 * `docs/plans/2026-11-08-pinnedIngredientsBar.md`; boards `RecipeDetailScrolledMobile` and
 * `RecipeDetailIngredientsOpenMobile`). The native twin of `PinnedIngredientsBar.tsx`.
 *
 * ONE button pinned at the top of the screen, under the status bar: "Ingredients for 4 / 13 items · 1 ticked / Show". It
 * opens the list in a panel directly under it, over a scrim, the servings stepper first. The bar has no stepper (a mistap
 * must never rescale a recipe mid-cook). The overlay stops at the bottom edge the screen's frame publishes, so the bar
 * and the panel never run under the tab bar or the bottom safe area; a list taller than the room scrolls inside the panel.
 *
 * All text is the design-system `Text` at the chrome cap (1.5x), so the bar never draws larger than the page title
 * (`designAnswers.md`, 2026-11-07). The Android back button closes the list through the back seam (ADR-0056), asked only
 * while the list is open.
 *
 * shortcut: the board's elevation (`shadow-lg` on the bar, `shadow-xl` on the panel) waits for a design-system shadow
 * primitive, as the page's cards do (`detailFrames.native.ts`); the hairline and the scrim carry the edge until then.
 */
import { useBackIntercept } from '@commise/ui/back-intercept';
import { Icon } from '@commise/ui/icon';
import { useBottomEdge } from '@commise/ui/layout';
import { PressScale } from '@commise/ui/press-scale';
import { Text } from '@commise/ui/text';
import type { FC, ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { styled, View, XStack, YStack } from 'tamagui';

import type { PinnedIngredientsBarProps } from './PinnedIngredientsBar.js';

/** The overlay: the screen above the bottom edge. It takes no touch of its own, so the page under a closed bar scrolls. */
const Overlay = styled(YStack, {
    name: 'PinnedIngredientsOverlay',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    pointerEvents: 'box-none',
});

/** The scrim: the `scrim` role over the whole overlay. */
const Scrim = styled(View, {
    name: 'PinnedIngredientsScrim',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '$scrim',
});

/** The bar and the panel under it, 12 from each side. */
const Column = styled(YStack, {
    name: 'PinnedIngredientsColumn',
    flex: 1,
    gap: '$2',
    paddingHorizontal: '$3',
    pointerEvents: 'box-none',
});

/** The bar: paper, the large radius, a hairline edge, 64 tall at least, so a larger text grows it. */
const BarFrame = styled(XStack, {
    name: 'PinnedIngredientsBarFrame',
    alignItems: 'center',
    gap: '$3',
    minHeight: 64,
    paddingVertical: '$2',
    paddingLeft: '$4',
    paddingRight: '$3',
    backgroundColor: '$paper',
    borderRadius: '$lg',
    borderWidth: '$hairline',
    borderColor: '$lineDivider',
});

/** The 36 circle at the end of the bar, in the `action` colour. */
const Well = styled(View, {
    name: 'PinnedIngredientsWell',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '$action',
});

/** The panel: paper, the large radius and a hairline edge; it shrinks to the room and scrolls inside. */
const Panel = styled(YStack, {
    name: 'PinnedIngredientsPanel',
    flexShrink: 1,
    overflow: 'hidden',
    backgroundColor: '$paper',
    borderRadius: '$lg',
    borderWidth: '$hairline',
    borderColor: '$lineDivider',
});

/** Mounted only while the list is open, so the back press is asked of it and of nothing else. */
const CloseOnBack: FC<{ readonly onBack: () => void }> = ({ onBack }) => {
    useBackIntercept(() => {
        onBack();

        return true;
    });

    return null;
};

/**
 * The pinned bar, its scrim and its list. Orchestration of its own back-press seam: whether the list is open is the
 * shell's, handed in as props.
 */
export const PinnedIngredientsBar: FC<
    Omit<PinnedIngredientsBarProps, 'children'> & { readonly children: ReactNode }
> = ({ facts, open, onOpenChange, scrimLabel, children }) => {
    const { top } = useSafeAreaInsets();
    const bottomEdge = useBottomEdge();

    return (
        <Overlay bottom={bottomEdge}>
            {open && <Scrim role="button" aria-label={scrimLabel} onPress={() => onOpenChange(false)} />}
            <Column paddingTop={top + 8}>
                <PressScale
                    onPress={() => onOpenChange(!open)}
                    accessibilityRole="button"
                    accessibilityLabel={facts.name}
                    expanded={open}
                    width="fill"
                >
                    <BarFrame>
                        <YStack flex={1} flexShrink={1} aria-hidden>
                            <Text typeRole="label" chromeCap="1.5" color="$ink" fontWeight="600">
                                {facts.heading}{' '}
                                <Text typeRole="meta" chromeCap="1.5" color="$inkMuted">
                                    {facts.forServings}
                                </Text>
                            </Text>
                            <Text typeRole="meta" chromeCap="1.5" color="$inkMuted" figures>
                                {facts.meta}
                            </Text>
                        </YStack>
                        <Text typeRole="label" chromeCap="1.5" color="$actionText" fontWeight="600" aria-hidden>
                            {facts.cue}
                        </Text>
                        <Well aria-hidden>
                            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={20} tone="onAction" />
                        </Well>
                    </BarFrame>
                </PressScale>
                {open && (
                    <Panel role="dialog" aria-label={facts.dialogName}>
                        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
                    </Panel>
                )}
            </Column>
            {open && <CloseOnBack onBack={() => onOpenChange(false)} />}
        </Overlay>
    );
};
