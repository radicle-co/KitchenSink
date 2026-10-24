import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { darkThemeSelector } from '../darkThemeSelector.js';

/** Runs the plugin over a stylesheet and returns the result with whitespace collapsed. */
function run(css: string): string {
    return postcss([darkThemeSelector()]).process(css, { from: undefined }).css.replace(/\s+/g, ' ').trim();
}

describe('darkThemeSelector', () => {
    it.each([
        ['spaced', '@media (prefers-color-scheme: dark) { :root { --a: 1; } }'],
        ['minified', '@media (prefers-color-scheme:dark){:root{--a:1}}'],
        ['upper case', '@media (PREFERS-COLOR-SCHEME: DARK) { :root { --a: 1; } }'],
        ['padded', '@media ( prefers-color-scheme : dark ) { :root { --a: 1; } }'],
    ])('rewrites the dark media block (%s) into the data-theme selector', (_label, css) => {
        const out = run(css);

        expect(out).toMatch(/^:root\[data-theme="dark"\] ?\{ ?--a: ?1;? ?\}$/);
        expect(out).not.toContain('@media');
        expect(out).not.toContain('prefers-color-scheme');
    });

    it('keeps every declaration and every rule inside the block, in order', () => {
        const out = run('@media (prefers-color-scheme: dark) { :root { --a: 1; --b: 2; } :root { --c: 3; } }');

        expect(out).toBe(':root[data-theme="dark"] { --a: 1; --b: 2; } :root[data-theme="dark"] { --c: 3; }');
    });

    it('leaves the light rules and the rules around the block where they were', () => {
        const out = run(
            ':root { --a: 0; } @media (prefers-color-scheme: dark) { :root { --a: 1; } } .x { color: red; }',
        );

        expect(out).toBe(':root { --a: 0; } :root[data-theme="dark"] { --a: 1; } .x { color: red; }');
    });

    it.each([
        ['another media query', '@media (min-width: 40rem) { :root { --a: 1; } }'],
        ['the light scheme', '@media (prefers-color-scheme: light) { :root { --a: 1; } }'],
        ['a compound query', '@media (prefers-color-scheme: dark) and (min-width: 40rem) { :root { --a: 1; } }'],
        ['reduced motion', '@media (prefers-reduced-motion: reduce) { :root { --a: 1; } }'],
    ])('does not touch %s', (_label, css) => {
        expect(run(css)).toBe(css.replace(/\s+/g, ' ').trim());
    });

    it('does not touch a dark media block nested inside another rule', () => {
        const css = '@layer base { @media (prefers-color-scheme: dark) { :root { --a: 1; } } }';

        expect(run(css)).toBe(css);
    });

    it('fails closed on a dark block holding anything but :root rules', () => {
        expect(() => run('@media (prefers-color-scheme: dark) { .x { color: red; } }')).toThrow(/prefers-color-scheme/);
        expect(() => run('@media (prefers-color-scheme: dark) { :root, :host { --a: 1; } }')).toThrow(
            /prefers-color-scheme/,
        );
        expect(() => run('@media (prefers-color-scheme: dark) { @supports (a: b) { :root { --a: 1; } } }')).toThrow(
            /prefers-color-scheme/,
        );
    });
});
