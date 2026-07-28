/**
 * @module test-utils/dsPill — locate the design-system `Button`'s styled pill inside a native control.
 *
 * The native DS `Button` composes `PressScale` (which renders the accessible `Pressable`) AROUND the styled
 * pill `View`, so the geometry and fill live on a DESCENDANT of the `role="button"` element rather than on it.
 * Every native DS-surface assertion therefore has to find that descendant first, and it must find it the way
 * the design system's own tests do — by the RESOLVED computed style, because react-native-web compiles
 * `StyleSheet` metrics to atomic CSS classes instead of inline styles.
 *
 * That lookup is ONE fact about the design system, not one per call site: it is shared here so a change to how
 * `Button` composes its pill breaks in a single place instead of drifting across the feature's native suites.
 *
 * It lives under `src/__tests__/` (not the package's `test-utils/`, which holds the vitest module ALIASES) for
 * two reasons: `tsconfig`'s `rootDir` is `src`, so a helper imported by a spec must sit under it; and
 * `tsconfig.build.json` already excludes every `__tests__` directory under `src`, so test-only code stays out
 * of the built package.
 */

/** The touch-target floor the native DS `Button` guarantees on every tier, in CSS pixels. */
const DS_TOUCH_FLOOR = '44px';

/**
 * Find the DS Button's styled pill inside an accessible native button element.
 *
 * Throwing (rather than returning `undefined`) is deliberate: the absence of a 44pt surface IS the
 * regression these tests exist to catch, so the lookup itself is a meaningful assertion.
 *
 * @param button - The element carrying `role="button"` (what `getByRole` returns).
 * @returns The descendant (or the element itself) that paints the DS pill.
 * @throws Error when no element in the subtree meets the DS touch floor.
 */
export function pillOf(button: HTMLElement): HTMLElement {
    const candidates = [button, ...Array.from(button.querySelectorAll<HTMLElement>('*'))];
    const pill = candidates.find((element) => window.getComputedStyle(element).minHeight === DS_TOUCH_FLOOR);

    if (pill === undefined) {
        throw new Error(
            `No ${DS_TOUCH_FLOOR} DS pill found inside "${button.getAttribute('aria-label') ?? button.textContent ?? ''}" — the touch floor is gone.`,
        );
    }

    return pill;
}
