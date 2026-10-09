/**
 * @module screenEnvironment/useWindowWidth — the window's width, pt (native), from React Native's own window
 * dimensions. Internal to `@commise/ui`.
 */
import { useWindowDimensions } from 'react-native';

/** The window's width, pt. */
export function useWindowWidth(): number {
    return useWindowDimensions().width;
}
