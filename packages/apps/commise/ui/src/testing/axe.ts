/**
 * @module testing/axe — the ONE axe check every web component test runs: the WCAG 2.1 A and AA rules, with colour
 * contrast off because jsdom cannot compute colour (the browser spec checks it). The rule set is stated here and
 * nowhere else, so a test never copies it. {@link toHaveNoViolations} is registered by `testing/axeSetup`.
 */
import { configureAxe, toHaveNoViolations } from 'jest-axe';

/** The matcher `toHaveNoViolations`, which `jest-axe` types for Jest only. */
interface AxeMatchers<R = unknown> {
    toHaveNoViolations(): R;
}

declare module 'vitest' {
    /*
     * Vitest declares `Matchers<T = any>`, and an augmentation must repeat its parameters exactly. Merging
     * `AxeMatchers` into it adds the matcher to `expect` and to the asymmetric matchers, with no member of its own.
     */
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type -- above */
    interface Matchers<T = any> extends AxeMatchers<T> {}
}

/**
 * Runs axe over a rendered tree.
 *
 * @param html - The element to check, usually the render's `container`.
 * @returns The results, for `toHaveNoViolations`.
 * @sideEffect Runs axe-core over the document.
 */
export const axe = configureAxe({
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
});

export { toHaveNoViolations };
