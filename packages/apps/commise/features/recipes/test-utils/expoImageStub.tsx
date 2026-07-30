/**
 * @module test-utils/expoImageStub — a jsdom stand-in for `expo-image`'s `Image`, aliased in by
 * `vitest.native.config.ts`. `expo-image` is a native module with no jsdom runtime (like `@expo/vector-icons`),
 * so the native leaves that adopt it for disk-cached remote images (B11) would otherwise fail to import under
 * the native component tests. This stub bridges the props those leaves use onto react-native-web's `Image` —
 * `source`/`style`/`accessibilityLabel` pass straight through, and expo-image's `contentFit` maps back to RN's
 * `resizeMode` — so the rendered `<img alt>` node stays identical for the tests. `cachePolicy` is display-inert
 * and dropped.
 */
import type { FC } from 'react';
import { Image as RNImage, type ImageProps as RNImageProps } from 'react-native';

/** The subset of expo-image `Image` props the recipe native leaves pass. */
interface ExpoImageStubProps {
    readonly source: RNImageProps['source'];
    readonly style?: RNImageProps['style'];
    readonly accessibilityLabel?: string;
    readonly accessible?: boolean;
    /** expo-image's replacement for `resizeMode`; mapped back to RN for the stub. */
    readonly contentFit?: RNImageProps['resizeMode'];
    /** Disk/memory cache selector on the real component — no visual effect, so dropped here. */
    readonly cachePolicy?: string;
}

export const Image: FC<ExpoImageStubProps> = ({ source, style, accessibilityLabel, accessible, contentFit }) => (
    <RNImage
        source={source}
        {...(style !== undefined ? { style } : {})}
        {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
        {...(accessible !== undefined ? { accessible } : {})}
        {...(contentFit !== undefined ? { resizeMode: contentFit } : {})}
    />
);
