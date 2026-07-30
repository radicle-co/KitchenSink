/**
 * @module tests/stubs/expoImage — jsdom stand-in for `expo-image`, aliased in by `vitest.native.config.ts`.
 * `expo-image` imports `expo-modules-core`'s native `NativeModule` (absent under jsdom), so loading it aborts
 * the mobile `.native` screen suite. The mobile leaves render remote images via `expo-image`'s `Image`
 * (B11); tests query by accessible name, so bridge the used props onto react-native-web's `Image`.
 */
import type { FC } from 'react';
import { Image as RNImage, type ImageProps as RNImageProps } from 'react-native';

interface ExpoImageStubProps {
    readonly source: RNImageProps['source'];
    readonly style?: RNImageProps['style'];
    readonly accessibilityLabel?: string;
    readonly accessible?: boolean;
    readonly contentFit?: RNImageProps['resizeMode'];
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
