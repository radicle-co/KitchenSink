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

/** The mounted native node React Native's accessibility API accepts. */
export type ScreenReaderFocusTarget = Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0];

/**
 * Move screen-reader focus onto `node`.
 *
 * @param node - The mounted host node, or nothing when the target is not on screen (a no-op, never a crash).
 * @sideEffect Sends an accessibility `'focus'` event to the platform screen reader.
 */
export function moveScreenReaderFocus(node: ScreenReaderFocusTarget | null | undefined): void {
    if (node === null || node === undefined) {
        return;
    }

    AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
}
