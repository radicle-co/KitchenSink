/**
 * @module @commise/ui/sheet — the frame around the bottom sheet's scroll region, which never collapses below one
 * control.
 *
 * Why the floor exists, and the one case where it can bind once the sheet has settled, are in
 * `docs/design/compactHeightLayout.md` §3.3 (issue #192: a region laid out at zero height for one frame cost a typed
 * field its focus on Android).
 *
 * It grows and shrinks as the bare `ScrollView` did (React Native gives a `ScrollView` `flexGrow: 1, flexShrink: 1`).
 * The `ScrollView` stays React Native's, inside it, so its ref and its scroll events are unchanged.
 *
 * A presentational component: a styled frame that adds no props and holds no state.
 *
 * @pattern Decorator — a layout floor around the scroll region, which it passes through untouched
 */
import { styled, YStack } from 'tamagui';

import { touchFloor } from '../layout/touchFloor.native.js';

/** The frame the sheet's `ScrollView` sits in: as flexible as the `ScrollView`, and at least one control tall. */
export const SheetScrollRegion = styled(YStack, {
    name: 'SheetScrollRegion',
    flexGrow: 1,
    flexShrink: 1,
    minHeight: touchFloor(),
});
