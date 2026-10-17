/**
 * @module @commise/ui/testing/system-color-scheme: the one test double for the device's colour scheme, and the one
 * way a native test turns a role colour into what `getComputedStyle` reports.
 *
 * Eleven native tests each carried their own hoisted `{ current }` holder, their own `useColorScheme` mock and their
 * own `formatRgb` import, which also meant each consuming package declared (or hoisted) `culori` for the sake of a
 * test assertion. They now share this module, so `culori` is this package's dependency alone.
 *
 * Use it from a `react-native` mock FACTORY through a dynamic import, because `vi.mock` is hoisted above static
 * imports and a factory that named an imported binding would read it before it exists:
 *
 * ```ts
 * vi.mock('react-native', async (importOriginal) => {
 *     const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
 *
 *     return withSystemScheme(await importOriginal<typeof import('react-native')>());
 * });
 * ```
 *
 * @pattern Test Double (Stub) — a mutable holder behind a faked `useColorScheme`
 */
import { formatRgb } from 'culori';

import { role, roleDark } from '../tokens/colors.js';

/** The scheme the device reports: `null` is "no preference", which the design system reads as light. */
export type SystemScheme = 'light' | 'dark' | null;

/** The scheme the next render sees. Set it in a test; reset it to `null` in `afterEach`. */
export const systemScheme: { current: SystemScheme } = { current: null };

/**
 * `react-native` with its `useColorScheme` reading {@link systemScheme}. Pure.
 *
 * @param actual - The real module, from `importOriginal`.
 * @returns The same members, with `useColorScheme` replaced.
 */
export function withSystemScheme<T extends object>(
    actual: T,
): Omit<T, 'useColorScheme'> & {
    readonly useColorScheme: () => SystemScheme;
} {
    return { ...actual, useColorScheme: () => systemScheme.current };
}

/**
 * The role table a scheme paints with. Pure.
 *
 * @param scheme - The scheme.
 * @returns `roleDark` for dark, `role` otherwise.
 */
export const rolesFor = (scheme: SystemScheme): typeof role | typeof roleDark => (scheme === 'dark' ? roleDark : role);

/**
 * A colour as `getComputedStyle` reports it: `rgb(r, g, b)`. Throws on a value that is not a colour, because
 * `formatRgb` answers `undefined` for one and two `undefined`s compare equal. Pure.
 *
 * @param color - Any CSS colour, such as a role's hex.
 * @returns The `rgb(...)` text.
 */
export function rgb(color: string): string {
    const formatted = formatRgb(color);

    if (formatted === undefined) {
        throw new Error(`rgb: "${color}" is not a colour`);
    }

    return formatted;
}
