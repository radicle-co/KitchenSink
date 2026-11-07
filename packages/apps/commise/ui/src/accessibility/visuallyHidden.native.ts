/**
 * @module @commise/ui — the native "visually hidden" style: out of the layout flow and one point square, yet still in
 * the accessibility tree, so a screen reader reads what the eye does not see. The one authority: the typed LiveRegion's
 * `offFlow` variant restates it as a literal, and its test holds the two equal.
 */
import { StyleSheet } from 'react-native';

/** The geometry itself, as a plain object, so a Tamagui variant can take it as well as a React Native style. */
export const VISUALLY_HIDDEN_GEOMETRY = { position: 'absolute', width: 1, height: 1, overflow: 'hidden' } as const;

export const { visuallyHidden } = StyleSheet.create({ visuallyHidden: VISUALLY_HIDDEN_GEOMETRY });
