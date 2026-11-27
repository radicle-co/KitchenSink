/**
 * @module testing/axe — the ONE axe check every web component test runs: the WCAG 2.1 A and AA rules, with colour
 * contrast off because jsdom cannot compute colour (the browser spec checks it). The rule set is stated here and
 * nowhere else, so a test never copies it. {@link toHaveNoViolations} is registered by `testing/axeSetup`.
 */
import { configureAxe, toHaveNoViolations } from 'jest-axe';

declare module 'vitest' {
    // `jest-axe` types its matcher for Jest, so Vitest's `expect` gets its own declaration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- Vitest's own `Assertion<T = any>` shape, which an augmentation must repeat
    interface Assertion<T = any> {
        toHaveNoViolations(): void;
    }
    interface AsymmetricMatchersContaining {
        toHaveNoViolations(): void;
    }
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
