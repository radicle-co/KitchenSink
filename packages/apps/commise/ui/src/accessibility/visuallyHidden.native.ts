/**
 * @module @commise/ui — the native "visually hidden" style: out of the layout flow and one point square, yet still in
 * the accessibility tree, so a screen reader reads what the eye does not see. The one copy.
 */
import { StyleSheet } from 'react-native';

export const { visuallyHidden } = StyleSheet.create({
    visuallyHidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
});
