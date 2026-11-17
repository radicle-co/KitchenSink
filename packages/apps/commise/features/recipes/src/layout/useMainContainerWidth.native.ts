/**
 * @module @commise/features-recipes/layout — the native content width: native shows no sidebar, so it is the window
 * less its gutters (`contentWidthOf`), the same width the native container class reads.
 */
import { contentWidthOf } from '@commise/ui/container-class';
import { useWindowDimensions } from 'react-native';

/**
 * The content width of the screen.
 *
 * @returns The width, in dp.
 */
export function useMainContainerWidth(): number {
    return contentWidthOf(useWindowDimensions().width);
}
