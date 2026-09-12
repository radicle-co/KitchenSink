/**
 * @module test-utils/expoImageStub — a jsdom stand-in for `expo-image`'s `Image`, aliased in by
 * `vitest.native.config.ts`. `expo-image` is a native module with no jsdom runtime (like `@expo/vector-icons`),
 * so the native leaves that adopt it for disk-cached remote images (B11) would otherwise fail to import under
 * the native component tests. This stub bridges the props those leaves use onto react-native-web's `Image` —
 * `source`/`style`/`accessibilityLabel` pass straight through, and expo-image's `contentFit` maps back to RN's
 * `resizeMode` — so the rendered `<img alt>` node stays identical for the tests. `cachePolicy` is display-inert
 * and dropped.
 *
 * ## Why the accessibility-hiding props are TRANSLATED, not passed through
 *
 * react-native-web does not implement RN's `accessibilityElementsHidden` (iOS) or `importantForAccessibility`
 * (Android) — they are absent from its forwarded-prop list and are dropped without warning, so a cover image
 * hidden from assistive tech on device would look fully exposed in the DOM and no test could tell the two
 * apart. RN's own `View` performs exactly the inverse translation (`aria-hidden` → those two props), so this
 * stub applies it in the RN → DOM direction and RNW emits `aria-hidden="true"`. The assertion in
 * `RecipeCard.native.test.tsx` therefore observes the leaf's real intent (see #140).
 *
 * `aria-hidden` is emitted only when **both** props are present, because each covers exactly one platform:
 * `accessibilityElementsHidden` is the iOS-effective prop and `importantForAccessibility` the Android one. A
 * leaf carrying only one of them is hidden on one platform and exposed on the other — a half-fix this harness
 * must fail rather than round up to "hidden" (a mutation that dropped the Android half survived until it did).
 */
import type { FC } from 'react';
import { Image as RNImage, type ImageProps as RNImageProps } from 'react-native';

/** The subset of expo-image `Image` props the recipe native leaves pass. */
interface ExpoImageStubProps {
    readonly source: RNImageProps['source'];
    readonly style?: RNImageProps['style'];
    readonly accessibilityLabel?: string;
    readonly accessible?: boolean;
    /** iOS: excludes this element (and its subtree) from the accessibility tree. */
    readonly accessibilityElementsHidden?: boolean;
    /** Android: `'no-hide-descendants'` is the counterpart of the iOS prop above. */
    readonly importantForAccessibility?: RNImageProps['importantForAccessibility'];
    /** expo-image's replacement for `resizeMode`; mapped back to RN for the stub. */
    readonly contentFit?: RNImageProps['resizeMode'];
    /** Disk/memory cache selector on the real component — no visual effect, so dropped here. */
    readonly cachePolicy?: string;
}

export const Image: FC<ExpoImageStubProps> = ({
    source,
    style,
    accessibilityLabel,
    accessible,
    accessibilityElementsHidden,
    importantForAccessibility,
    contentFit,
}) => {
    // Hidden on EVERY platform (iOS prop AND Android prop) — the DOM spelling of which is `aria-hidden`, the
    // one form react-native-web actually honours.
    const hidden = accessibilityElementsHidden === true && importantForAccessibility === 'no-hide-descendants';

    return (
        <RNImage
            source={source}
            {...(style !== undefined ? { style } : {})}
            {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
            {...(accessible !== undefined ? { accessible } : {})}
            {...(hidden ? { 'aria-hidden': true } : {})}
            {...(contentFit !== undefined ? { resizeMode: contentFit } : {})}
        />
    );
};
