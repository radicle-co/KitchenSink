/**
 * @module @commise/features-recipes/layout — the native container class: native shows no sidebar, so the content width
 * is the window less its gutters, which `@commise/ui/layout`'s `useContainerClass` already reads.
 *
 * @pattern Adapter — the web hook's contract over the design system's native reading
 */
import { contentWidthOf, type ContainerClass } from '@commise/ui/container-class';
import { useContainerClass } from '@commise/ui/layout';
import { useWindowDimensions } from 'react-native';

/**
 * The container class of the screen's content.
 *
 * @returns `narrow`, `regular` or `wide`.
 */
export function useMainContainerClass(): ContainerClass {
    return useContainerClass();
}

/**
 * The content width of the screen in dp: the window less its gutters.
 *
 * @returns The width, in dp.
 */
export function useMainContainerWidth(): number {
    return contentWidthOf(useWindowDimensions().width);
}
