/**
 * @module @commise/ui/screen-reader-focus — move the SCREEN-READER cursor, never the keyboard (React Native only).
 *
 * The one place in the design system that knows how: every native leaf that must put VoiceOver/TalkBack focus
 * somewhere — onto a form that just opened, onto the control a removed one gave way to — calls this rather than
 * reaching for `AccessibilityInfo` itself. It moves the READING cursor only: a `TextInput` receiving it is not
 * given text-entry focus, so no keyboard is raised unasked.
 *
 * ⛔ `sendAccessibilityEvent(node, 'focus')`, not `setAccessibilityFocus`, which React Native 0.86 marks
 * `@deprecated`.
 *
 * @pattern Adapter over `AccessibilityInfo.sendAccessibilityEvent`
 */
import { AccessibilityInfo } from 'react-native';
import type { TamaguiTextElement } from 'tamagui';

/** The mounted native node React Native's accessibility API accepts. */
export type ScreenReaderFocusTarget = Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0];

/** A node the cursor can move onto: a React Native host node, or the node a Tamagui `Text` hands back. */
export type FocusableNode = ScreenReaderFocusTarget | TamaguiTextElement;

/**
 * Move screen-reader focus onto `node`.
 *
 * @param node - The mounted host node, or nothing when the target is not on screen (a no-op, never a crash).
 * @sideEffect Sends an accessibility `'focus'` event to the platform screen reader.
 */
export function moveScreenReaderFocus(node: FocusableNode | null | undefined): void {
    if (node === null || node === undefined) {
        return;
    }

    // The one cast: on a device the node a Tamagui `Text` hands back IS the React Native host instance, which Tamagui types
    // as a DOM-style element on every platform. React Native's accessibility API takes the host type.
    AccessibilityInfo.sendAccessibilityEvent(node as ScreenReaderFocusTarget, 'focus');
}
