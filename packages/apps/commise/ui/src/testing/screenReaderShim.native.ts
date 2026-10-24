/**
 * @module @commise/ui/testing/screen-reader-shim — a Vitest setup file for the jsdom native suites: no-ops for the two
 * screen-reader calls the native leaves make that react-native-web does not implement.
 *
 * Moving the reading cursor (`sendAccessibilityEvent`) and the iOS announcement (`announceForAccessibilityWithOptions`)
 * are device APIs; under react-native-web they are absent, so any screen rendering a leaf that uses them — a
 * `ConfirmDialog` asks for the cursor on Keep as it opens — would throw `is not a function`. They are no-ops here, as
 * they are on a device with no screen reader running. A suite that asserts on them mocks `react-native` itself, which
 * wins over this.
 *
 * Every `vitest.native.config.ts` lists it in `setupFiles`. It was a private copy in the mobile app's setup; it lives
 * here so the design system's own suites, the features' and the app's read one definition.
 */
import { AccessibilityInfo } from 'react-native';

if (typeof AccessibilityInfo.sendAccessibilityEvent !== 'function') {
    AccessibilityInfo.sendAccessibilityEvent = () => undefined;
}

if (typeof AccessibilityInfo.announceForAccessibilityWithOptions !== 'function') {
    AccessibilityInfo.announceForAccessibilityWithOptions = () => undefined;
}
