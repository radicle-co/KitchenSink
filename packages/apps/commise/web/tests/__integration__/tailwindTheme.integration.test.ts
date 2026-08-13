// @vitest-environment node
/**
 * The design system's `@theme` block must land in Tailwind v4's REAL namespaces — asserted by compiling the
 * app's actual stylesheet with the app's actual compiler and reading what a utility resolves to.
 *
 * ## Why this test exists
 *
 * `@commise/ui`'s `themeCss()` derives each custom-property prefix from the SOURCE VARIABLE'S NAME
 * (`color` → `--color-*`, `radius` → `--radius-*`, …). That is correct only by coincidence: Tailwind v4 has a
 * fixed set of theme namespaces, and three of the emitted prefixes did not match it.
 *
 *   - `--spacing-*` IS a live namespace, so the DS ramp silently REDEFINED the numeric utilities: `size-8`
 *     resolved to `4rem` (64px) instead of `2rem` (32px). Steps 0-4 coincide with Tailwind's own values, so
 *     only 5-9 drifted — which is exactly why it survived review. Undefined steps (`h-14`, `min-h-11`) kept
 *     resolving through the default `--spacing` base, leaving ONE stylesheet with TWO spacing systems.
 *   - `--font-size-*` and `--line-height-*` are NOT namespaces at all (v4 uses `--text-*` / `--leading-*`), so
 *     every `text-body-sm` / `text-display-md` / `leading-body` in the app compiled to NOTHING and the element
 *     silently inherited its parent's size. The entire DS type ramp had never shipped to web.
 *
 * ## Why it is shaped this way
 *
 * No existing test could catch either defect: nothing in the repo compiled Tailwind or read `dist/theme.css`.
 * The unit tests assert token VALUES (which were always right) and the jsdom geometry tests re-implement the
 * CSS model in JavaScript — so they confirm their own assumptions rather than the stylesheet. The only honest
 * check is to run the real compiler and read the real declaration, which is what this does.
 *
 * It compiles `src/app/globals.css` itself — not a hand-built fixture — so the whole chain is under test:
 * token → `themeCss()` → `dist/theme.css` → the `@import` in `globals.css` → Tailwind's namespace handling.
 * `@source inline(...)` is appended ONLY to guarantee the probe utilities are generated regardless of what
 * the app happens to use today; it can add candidates, never mask a wrong declaration.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

const GLOBALS_CSS = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url));

/** Utilities probed below. Forced into the build so the test never depends on current app usage. */
const PROBES = [
    'bg-pearl',
    'border-slate',
    'border-seafoam',
    'rounded-t-lg',
    'size-8',
    'size-6',
    'size-5',
    'h-14',
    'min-h-11',
    'p-6',
    'text-body-sm',
    'text-display-md',
    'text-caption',
    'leading-body',
    'text-sm',
    'bg-hero',
] as const;

/**
 * Compile the app's real stylesheet and return its CSS text.
 *
 * @sideEffect Reads `globals.css` from disk and runs the Tailwind compiler (which scans the configured
 *   `@source` globs).
 */
async function compileAppCss(): Promise<string> {
    const source = await readFile(GLOBALS_CSS, 'utf8');
    const withProbes = `${source}\n@source inline("${PROBES.join(' ')}");\n`;

    const result = await postcss([tailwind()]).process(withProbes, { from: GLOBALS_CSS });

    return result.css;
}

/**
 * The declaration body Tailwind generated for a single utility class, or `undefined` if it emitted none.
 *
 * All whitespace is stripped and any trailing `;` dropped, so the assertions below hold whether the compiler
 * pretty-prints (as it does here) or minifies (as the production `.next` build does) — the test asserts what
 * a utility RESOLVES TO, never how it happens to be formatted.
 */
function ruleFor(css: string, utility: string): string | undefined {
    // Escape every regex metacharacter, not just `-`: a partial escape silently mis-parses any utility
    // carrying a `.`, `[` or `\` (arbitrary-value utilities do), and leaves the literal match only apparently exact.
    // `-` is deliberately NOT in the set: it is literal outside a character class, and escaping it emits `\-`,
    // which a `u`-flagged pattern rejects as an invalid escape — so every utility carrying a hyphen (`size-8`,
    // `h-14`, i.e. nearly all of them) threw at construction.
    const escaped = utility.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`, 'u').exec(css);

    return match?.[1].replace(/\s+/g, '').replace(/;$/, '');
}

describe('@commise/ui theme.css → Tailwind v4 namespaces (compiled)', () => {
    // One compile shared by every assertion: the scan is the expensive part, and each `it` reads a different
    // property of the same artifact.
    const cssPromise = compileAppCss();

    it('does not redefine the numeric spacing scale (a DS ramp must never hijack --spacing-*)', async () => {
        const css = await cssPromise;

        // `size-8` is the top-bar avatar disc and the recipe step marker. The mockups (`screen-home`:
        // `w-8 h-8`) and the native leaves (`width: 32`) both mean 32px, so Tailwind's default MUST win.
        expect(ruleFor(css, 'size-8')).toBe('width:calc(var(--spacing)*8);height:calc(var(--spacing)*8)');
        expect(css).toMatch(/--spacing:\s*0?\.25rem/);
        expect(css).not.toMatch(/--spacing-\d+\s*:/);
    });

    it('keeps every numeric step on ONE scale, so defined and undefined steps cannot disagree', async () => {
        const css = await cssPromise;

        // The tell of the original bug: `size-8` resolved through a named `--spacing-8` while `h-14` resolved
        // through `calc(var(--spacing) * 14)` — two systems in one stylesheet, differing by 2x.
        expect(ruleFor(css, 'h-14')).toBe('height:calc(var(--spacing)*14)');
        expect(ruleFor(css, 'min-h-11')).toBe('min-height:calc(var(--spacing)*11)');
        expect(ruleFor(css, 'size-6')).toBe('width:calc(var(--spacing)*6);height:calc(var(--spacing)*6)');
        expect(ruleFor(css, 'size-5')).toBe('width:calc(var(--spacing)*5);height:calc(var(--spacing)*5)');
        expect(ruleFor(css, 'p-6')).toBe('padding:calc(var(--spacing)*6)');
    });

    it('ships the DS type ramp as real font-size utilities', async () => {
        const css = await cssPromise;

        // 184 `text-body-sm` and 7 `text-display-md` call sites generated NO rule before the fix. The
        // `/discover` <h1> is `text-display-md` and measured 16px (inherited) instead of 28px on the
        // deployed preview.
        expect(ruleFor(css, 'text-body-sm')).toBe('font-size:var(--text-body-sm)');
        expect(css).toMatch(/--text-body-sm:\s*0?\.875rem/);
        expect(ruleFor(css, 'text-display-md')).toBe('font-size:var(--text-display-md)');
        expect(css).toMatch(/--text-display-md:\s*1\.75rem/);
        expect(ruleFor(css, 'text-caption')).toBe('font-size:var(--text-caption)');

        // The dead namespaces must be GONE, not merely shadowed — leaving them emits bytes that look like a
        // working type ramp to the next reader while generating nothing.
        expect(css).not.toMatch(/--font-size-[a-z-]+\s*:/);
        expect(css).not.toMatch(/--line-height-[a-z-]+\s*:/);
    });

    it('ships the DS line-height ramp as real leading utilities', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'leading-body')).toBe('--tw-leading:var(--leading-body);line-height:var(--leading-body)');
        expect(css).toMatch(/--leading-body:\s*1\.5/);
    });

    it('leaves Tailwind’s own type scale intact (the DS ADDS names, it does not replace the namespace)', async () => {
        const css = await cssPromise;

        // Guards the opposite failure: "fixing" the namespace by clearing it (`--text-*: initial`) would break
        // every stock `text-sm`/`text-lg` the app also uses.
        expect(ruleFor(css, 'text-sm')).toContain('var(--text-sm)');
    });

    it('emits a real rule for every utility the source-tab affordance depends on', async () => {
        // "The class is in the JSX" is not proof it paints anything: this repo shipped an entire DS type ramp
        // that compiled to NOTHING. The recipe-source switcher's resting affordance is made of these four
        // utilities, so each must resolve to a declaration that actually names its token. They come from the
        // SHARED `@commise/features-recipes` package, which is why the `@source` glob for it is load-bearing —
        // drop that glob and these vanish while every jsdom test still passes.
        const css = await cssPromise;

        expect(ruleFor(css, 'bg-pearl'), 'the inactive tab’s resting fill').toContain('var(--color-pearl)');
        expect(ruleFor(css, 'border-slate'), 'the inactive tab’s boundary').toContain('var(--color-slate)');
        expect(ruleFor(css, 'border-seafoam'), 'the active tab’s underline').toContain('var(--color-seafoam)');
        expect(ruleFor(css, 'rounded-t-lg'), 'the folder-tab geometry').toContain('border-top-left-radius');
        // Variant-scoped utilities compile to a nested/at-ruled selector, so they are matched by presence
        // rather than by a flat `.class { … }` body — but they must be PRESENT, which is the regression risk.
        expect(css, 'the hover fill').toContain('hover\\:bg-mist\\/40');
        expect(css, 'the focus ring').toContain('focus-visible\\:ring-ocean-dark');
    });
});

/**
 * The page-canvas gradient must be REAL, EMITTED CSS on the `body` — the app's flat-vs-gradient defect.
 *
 * All nine wireframes paint `body { background: var(--gradient-beach-glow) }`; the app painted a flat
 * `background-color`. Two earlier failures on this exact surface dictate the shape of these assertions:
 *
 *  - A token can exist and still compile to nothing (`--font-size-*` was not a namespace, so 324 type-ramp
 *    call sites emitted zero CSS). So this reads the COMPILED declaration, never `themeCss()`'s string.
 *  - A jsdom component test once stubbed its own stylesheet and passed at 32px while the app shipped 64px. So
 *    this compiles the app's real `globals.css` with the app's real compiler — the whole chain, token →
 *    `themeCss()` → `dist/theme.css` → `@import` → Tailwind — rather than simulating any part of it.
 *
 * Mutation lens: revert `body` to `background-color` alone and the first assertion fails; re-tone a stop and
 * the second fails; move the ramp back into a hand-written class and the fourth fails.
 */
describe('the beach-glow page canvas (compiled)', () => {
    const cssPromise = compileAppCss();

    /** The declaration body of the compiled `@layer base` rule for a bare element selector. */
    function baseRuleFor(css: string, element: string): string | undefined {
        const match = new RegExp(`(?:^|[{}\\s,])${element}\\s*\\{([^}]*)\\}`).exec(css);

        return match?.[1].replace(/\s+/g, '').replace(/;$/, '');
    }

    it('paints the gradient on body, from the token — not a flat background-color', async () => {
        const body = baseRuleFor(await cssPromise, 'body');

        expect(body).toBeDefined();
        expect(body).toContain('background-image:var(--background-image-hero)');
        // The solid colour stays as the pre-paint/unsupported fallback, so a canvas is never transparent.
        expect(body).toContain('background-color:var(--color-background)');
    });

    it('resolves --background-image-hero to the wireframes’ three-stop 135° ramp', async () => {
        const css = await cssPromise;

        expect(css).toContain(
            '--background-image-hero: linear-gradient(135deg, #FAF6F0 0%, #F0F7F4 50%, #E8F4F8 100%)',
        );
    });

    it('generates a usable bg-hero utility (the namespace is live, not merely plausible)', async () => {
        expect(ruleFor(await cssPromise, 'bg-hero')).toBe('background-image:var(--background-image-hero)');
    });

    /**
     * The drifted canvas tints must not be spelled ANYWHERE the compiler can see.
     *
     * The app shell and the mobile nav drawer each hand-rolled a ramp through two arbitrary-value stops
     * (mid `#F5F8FA`, end `#EDF5F8`) — a second and third representation of the canvas, already drifted from
     * the wireframes' own `#F0F7F4` / `#E8F4F8`. Both now consume the token, so those utilities should no
     * longer be generated at all; if one reappears, a duplicate definition is back.
     *
     * The hex codes are assembled below rather than written as class literals ON PURPOSE. Tailwind v4's
     * automatic source detection scans the whole non-ignored tree as TEXT — this test file included, comments
     * included — so naming the class verbatim anywhere, even in prose explaining why it is banned, REGENERATES
     * it and makes the assertion fail against itself. (Both the fix and this test tripped over exactly that.)
     */
    it('no longer compiles a SECOND, hand-spelled canvas gradient', async () => {
        const css = await cssPromise;
        const driftedMid = '#F5F8'.concat('FA');
        const driftedEnd = '#EDF5'.concat('F8');

        for (const [prefix, hex] of [
            ['via', driftedMid],
            ['to', driftedEnd],
        ] as const) {
            // Tailwind escapes `[`, `]` and `#` in the generated selector.
            expect(css).not.toContain(`.${prefix}-\\[\\${hex}\\]`);
        }
    });
});
