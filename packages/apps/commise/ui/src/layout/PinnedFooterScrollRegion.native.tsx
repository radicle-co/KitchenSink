/**
 * @module @commise/ui/layout — the frame around the scroll region of every frame that pins a footer
 * (`usePinnedFooter`), which never lets the region collapse below one control.
 *
 * The pin decision is read from `onLayout`, so it lands one layout pass after the frame changes. When a keyboard opens,
 * the frame is already short while the footer is still pinned, and for that pass the pinned chrome can take the whole
 * frame. A scroll region laid out at zero height there cost a focused field its focus on Android (issue #192). This
 * frame holds the region at the touch floor through that pass. Why, and the rule's side of it, are in
 * `docs/design/compactHeightLayout.md` §3.3.
 *
 * It grows and shrinks as the bare `ScrollView` did (React Native gives a `ScrollView` `flexGrow: 1, flexShrink: 1`).
 * The `ScrollView` stays React Native's, inside it, so its ref, its scroll events and its own style are unchanged.
 *
 * A presentational component: a styled frame that adds no props and holds no state.
 *
 * @pattern Decorator — a layout floor around a scroll region, which it passes through untouched
 */
import { styled, YStack } from 'tamagui';

import { touchFloor } from './touchFloor.native.js';

/** The frame a pinned-footer frame's `ScrollView` sits in: as flexible as the `ScrollView`, and at least one control tall. */
export const PinnedFooterScrollRegion = styled(YStack, {
    name: 'PinnedFooterScrollRegion',
    flexGrow: 1,
    flexShrink: 1,
    minHeight: touchFloor(),
});
