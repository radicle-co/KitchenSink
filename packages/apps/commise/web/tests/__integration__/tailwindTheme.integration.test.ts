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

import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { role, roleDark } from '@commise/ui/colors';
import { PRESS_FILL_CLASS, SURFACE_TONE_CLASS } from '@commise/ui/surface-tone';

const GLOBALS_CSS = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url));

/** Utilities probed below. Forced into the build so the test never depends on current app usage. */
const PROBES = [
    'bg-surface-muted',
    'border-line-control',
    'border-selected-edge',
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
    'text-sm',
    'bg-hero',
    'animate-pending-bar-reveal',
    'motion-safe:animate-section-enter',
    '-top-3.5',
    'nav:hidden',
    'medium:px-6',
    '@container/main',
    '@regular/main:grid-cols-2',
    '@wide/main:grid-cols-3',
    'max-w-page',
    'max-w-reading',
    'text-card-title',
    'text-list',
    'text-large-title',
    'text-label',
    'bg-paper',
    'text-ink-muted',
    'border-line-control',
    'bg-selected-fill',
    'bg-bar',
    'size-18',
    '@regular:w-30',
    'min-[480px]:bg-paper',
] as const;

/**
 * Compile the app's real stylesheet and return its CSS text.
 *
 * @sideEffect Reads `globals.css` from disk and runs the Tailwind compiler (which scans the configured
 *   `@source` globs).
 */
async function compileAppCss(): Promise<string> {
    const source = await readFile(GLOBALS_CSS, 'utf8');
    // The surface-tone and focus-ring recipes are probed from their own exports, so the test reads the very literals the
    // apps ship and never a copy of them; an app that stopped using one still has it compiled and checked.
    const recipes = [
        ...Object.values(FOCUS_RING_CLASS),
        ...Object.values(PRESS_FILL_CLASS),
        ...Object.values(SURFACE_TONE_CLASS),
    ].flatMap((classes) => classes.split(' '));
    const withProbes = `${source}\n@source inline("${[...PROBES, ...recipes].join(' ')}");\n`;

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

/** The slice-9 classes the Profile page and the Clerk appearance lean on, and the layer order Clerk's styles need. */
describe('the sign-in and Profile classes, compiled', () => {
    const cssPromise = compileAppCss();

    // Clerk's own styles are unlayered emotion CSS, which beats any utility; they are moved into the `clerk` layer, and
    // THIS statement ranks that layer below `utilities`. The first ordering statement of a layer name fixes its place,
    // so it must come before Tailwind's own `@layer theme, base, components, utilities`.
    it('ranks the clerk layer between base and components, BEFORE Tailwind declares its own order', async () => {
        const css = await cssPromise;
        const statements = [...css.matchAll(/^@layer\s+([^;{]+);/gmu)].map((match) => ({
            at: match.index ?? -1,
            layers: (match[1] ?? '').split(',').map((name) => name.trim()),
        }));
        const clerk = statements.find(({ layers }) => layers.includes('clerk'));
        const tailwind = statements.find(({ layers }) => !layers.includes('clerk') && layers.includes('components'));

        expect(clerk?.layers).toEqual(['theme', 'base', 'clerk', 'components', 'utilities']);
        expect(clerk?.at ?? Number.POSITIVE_INFINITY).toBeLessThan(tailwind?.at ?? -1);
    });

    it('keeps the font import ahead of every layer rule, where CSS still honours it', async () => {
        const css = await cssPromise;

        expect(css.indexOf('@import url(')).toBeGreaterThan(-1);
        expect(css.indexOf('@import url(')).toBeLessThan(css.indexOf('@layer'));
    });

    it('generates the 72 px avatar, the 600 px two-column term and the 480 px card utilities', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'size-18')).toBe('width:calc(var(--spacing)*18);height:calc(var(--spacing)*18)');
        expect(css).toMatch(/@container[^{]*\(width\s*>=\s*(?:600px|37\.5rem)\)/);
        expect(css).toMatch(/@media[^{]*\(width\s*>=\s*(?:480px|30rem)\)/);
    });
});

describe('the pinned back bar’s height, compiled', () => {
    it('reaches the browser as ONE property, with the notch’s inset added once, for every web use to read', async () => {
        const css = await compileAppCss();

        // Not a Tailwind namespace, so it survives only if something reads it: the stylesheet's own rules do.
        expect(css).toMatch(/--pinned-bar-height:\s*3\.5rem/);
        expect(css).toMatch(
            /--pinned-bar-block:\s*calc\(var\(--pinned-bar-height\)\s*\+\s*env\(safe-area-inset-top\)\)/,
        );
    });
});

describe('@commise/ui theme.css → Tailwind v4 namespaces (compiled)', () => {
    // One compile shared by every assertion: the scan is the expensive part, and each `it` reads a different
    // property of the same artifact.
    const cssPromise = compileAppCss();

    it('does not redefine the numeric spacing scale (a DS ramp must never hijack --spacing-*)', async () => {
        const css = await cssPromise;

        // `size-8` is the top-bar avatar disc and the recipe step marker. The mockups (`screenHome`:
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
        // The caption role (§1.5) adds its leading and weight to the ramp's own `--text-caption`, so the utility
        // carries both as fallbacks behind `--tw-leading` / `--tw-font-weight`: an explicit `leading-*` or `font-*`
        // class still wins. This used to be `font-size` alone, and every caption inherited the body's 1.5 leading.
        expect(ruleFor(css, 'text-caption')).toBe(
            'font-size:var(--text-caption);line-height:var(--tw-leading,var(--text-caption--line-height));font-weight:var(--tw-font-weight,var(--text-caption--font-weight))',
        );

        // The dead namespaces must be GONE, not merely shadowed — leaving them emits bytes that look like a
        // working type ramp to the next reader while generating nothing.
        expect(css).not.toMatch(/--font-size-[a-z-]+\s*:/);
        expect(css).not.toMatch(/--line-height-[a-z-]+\s*:/);
    });

    // REWRITTEN for the px type scale (owner ruling 2026-10-25): the `--leading-heading/body/caption` ratios (1.2, 1.5,
    // 1.4) gave 21, 21.6 and 33.6 px, off the 4 px grid, and nothing used them. A line height now comes from a type
    // role, as `calc(px / size)`; no ratio ramp is emitted.
    it('ships no ratio-based leading ramp: a line height comes from a type role', async () => {
        const css = await cssPromise;

        expect(css).not.toMatch(/--leading-(?:heading|body|caption):/u);
    });

    it('leaves Tailwind’s own type scale intact (the DS ADDS names, it does not replace the namespace)', async () => {
        const css = await cssPromise;

        // Guards the opposite failure: "fixing" the namespace by clearing it (`--text-*: initial`) would break
        // every stock `text-sm`/`text-lg` the app also uses.
        expect(ruleFor(css, 'text-sm')).toContain('var(--text-sm)');
    });

    /**
     * REWRITTEN (CI run 38010247909): this pinned the recipe-source tabs' utilities, and those tabs were deleted with
     * their dead component, so it asserted classes nothing renders. What it guards is unchanged: a utility used ONLY by
     * the SHARED `@commise/features-recipes` package compiles to a real rule, which holds only while the `@source`
     * glob for that package is in `globals.css`. The ingredient list's amount column and its second line's offset are
     * such utilities. They are assembled rather than spelled, because Tailwind scans this file as text too, and a
     * literal here would generate them whatever the glob says.
     */
    it('emits a real rule for a utility only the shared recipes package uses (its `@source` glob is load-bearing)', async () => {
        const css = await cssPromise;
        const cssClass = (utility: string): string =>
            `.${utility.replace(/[^\w-]/gu, (character) => `\\${character}`)}`;
        const amountColumn = 'w-['.concat('4.5rem]');
        const secondLineOffset = 'pl-[calc('.concat('4.5rem+0.75rem)]');

        expect(css, 'the amount column').toContain(`${cssClass(amountColumn)} {\n    width: 4.5rem;`);
        expect(css, 'the second line’s offset').toContain(
            `${cssClass(secondLineOffset)} {\n    padding-left: calc(4.5rem + 0.75rem);`,
        );
    });
});

/**
 * `@commise/ui`'s `PendingBar` reveals itself through the `animate-pending-bar-reveal` utility, with its delay set
 * inline from `PENDING_BAR_DELAY_MS`. The class being in the JSX proves nothing: if the theme token were missing the
 * utility would compile to NOTHING, and the bar would paint on the very first frame of every search — the flash the
 * delay exists to prevent — while every jsdom test still passed.
 */
describe('the pending-bar reveal (compiled)', () => {
    const cssPromise = compileAppCss();

    it('compiles the reveal utility to a zero-length animation that holds its from-state through the delay', async () => {
        const css = await cssPromise;
        const rule = ruleFor(css, 'animate-pending-bar-reveal');

        expect(rule, 'the utility must emit a declaration').toBeDefined();
        expect(rule).toContain('animation:var(--animate-pending-bar-reveal)');
        // `both` is what keeps the bar at opacity 0 during `animation-delay`; `0s` is what makes it a reveal, not motion.
        expect(css.replace(/\s+/g, ' ')).toMatch(/--animate-pending-bar-reveal: pending-bar-reveal 0s[^;]*both/);
    });

    it('centres the bar in the 24px gap above the results: 14px up (12px half-gap + 2px half-bar)', async () => {
        // `3.5` is not a DS spacing step, so it resolves through Tailwind's `--spacing` base. A DS ramp that ever
        // defines a fractional step would move the bar out of the gap without any jsdom test noticing.
        const css = await cssPromise;

        expect(ruleFor(css, '-top-3\\.5')).toBe('top:calc(var(--spacing)*-3.5)');
        expect(css).toMatch(/--spacing:\s*0?\.25rem/);
    });

    it('reveals by opacity alone, from 0 to 1', async () => {
        // Whitespace and a declaration's trailing `;` dropped, so a pretty-printed and a minified build read the same.
        const css = (await cssPromise).replace(/\s+/g, '').replace(/;\}/g, '}');
        const keyframes = /@keyframespending-bar-reveal\{(.*?\})\}/.exec(css)?.[1];

        expect(keyframes).toBe('from{opacity:0}to{opacity:1}');
    });
});

/**
 * The enter gesture (`animate-section-enter` on every discovery section) has its token and keyframes in
 * `@commise/ui/theme.css`, not in `globals.css`. A token that failed to
 * arrive would compile the utility to nothing and the section would simply not animate, with every jsdom test green.
 */
describe('the enter animations (compiled)', () => {
    const cssPromise = compileAppCss();

    it.each(['section-enter'])(
        'compiles %s to a 400ms ease-out animation behind motion-safe, with its keyframes',
        async (name) => {
            const css = await cssPromise;
            const flat = css.replace(/\s+/g, '').replace(/;\}/g, '}');

            expect(css.replace(/\s+/g, ' ')).toMatch(new RegExp(`--animate-${name}: ${name} 400ms ease-out both`));
            expect(flat).toContain(`.motion-safe\\:animate-${name}`);
            expect(flat).toContain(
                `@keyframes${name}{from{opacity:0;transform:translateY(0.5rem)}to{opacity:1;transform:none}}`,
            );
        },
    );
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
        // The solid colour stays as the pre-paint/unsupported fallback, so a canvas is never transparent. It is the
        // `canvas` role, which the dark block re-themes (the legacy `--color-background` would stay light).
        expect(body).toContain('background-color:var(--color-canvas)');
    });

    // REWRITTEN for the redesign: the canvas wash is flat (the canvas colour at 180 degrees, owner ruling), not the
    // wireframes' three-stop 135 degree ramp.
    it('resolves --background-image-hero to the flat canvas wash', async () => {
        const css = await cssPromise;

        expect(css).toMatch(/--background-image-hero:\s*linear-gradient\(180deg, #EFF3F6 0%, #EFF3F6 100%\)/iu);
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

/**
 * The overhaul's slice-1 foundation (`docs/design/uiOverhaul/buildSpec.md` §1.2-§1.5, blueprint A8): the navigation
 * breakpoint, the `main` container queries, the content widths, the type roles and the colour roles — each read from
 * the COMPILED stylesheet, because the blueprint's two load-bearing assumptions were Tailwind v4 behaviours:
 *
 *  1. that `--container-*` drives BOTH `max-w-*` AND the `@{name}/main:` size variants (so a content width named
 *     `wide` would hijack the `@wide` query — why the spec's `content-wide` is emitted as `page`); and
 *  2. that `--text-{role}--line-height` / `--font-weight` sub-properties reach the `text-{role}` utility.
 *
 * Mutation lens: rename `--container-page` to `--container-wide` and the `@wide/main:` row reads 90rem; drop a
 * sub-property and its utility row loses the declaration; emit the breakpoint under another name and `nav:` compiles
 * to nothing.
 */
describe('slice 1 — layout and role tokens (compiled)', () => {
    const cssPromise = compileAppCss();

    /** The `@media`/`@container` prelude that wraps a variant utility, or `undefined` if none does. */
    function preludeOf(css: string, escapedSelector: string): string | undefined {
        const index = css.indexOf(escapedSelector);

        if (index < 0) {
            return undefined;
        }

        const preludes = [...css.slice(0, index).matchAll(/@(media|container)[^{]*\{/gu)];

        return preludes.at(-1)?.[0].replace(/\s+/g, ' ').replace(/ ?\{$/u, '');
    }

    it('switches the shell at 840 px: nav: is a 52.5rem media query', async () => {
        expect(preludeOf(await cssPromise, '.nav\\:hidden')).toBe('@media (width >= 52.5rem)');
    });

    it('steps the gutter at 600 px: medium: is a 37.5rem media query', async () => {
        expect(preludeOf(await cssPromise, '.medium\\:px-6')).toBe('@media (width >= 37.5rem)');
    });

    it('names <main> as an inline-size container', async () => {
        expect(ruleFor(await cssPromise, '\\@container\\/main')).toBe('container-type:inline-size;container-name:main');
    });

    it('queries <main> at 600 px for @regular', async () => {
        expect(preludeOf(await cssPromise, '.\\@regular\\/main\\:grid-cols-2')).toBe(
            '@container main (width >= 37.5rem)',
        );
    });

    it('queries <main> at 960 px for @wide — not at the 1440 px page width', async () => {
        expect(preludeOf(await cssPromise, '.\\@wide\\/main\\:grid-cols-3')).toBe('@container main (width >= 60rem)');
    });

    // Slice 3: the floating layer's bar material (`tokens/barMaterial.ts`) is a variable the dark block overrides, so the
    // web tab bar re-themes with no `dark:` variant.
    it('compiles bg-bar to its variable, overridden in the dark block', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'bg-bar')).toBe('background-color:var(--color-bar)');
        expect(css).toMatch(/prefers-color-scheme:\s*dark[\s\S]*--color-bar:\s*rgba\(23, 32, 41, 0\.94\)/u);
    });

    it('caps a page at 90rem and a reading column at 40rem', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'max-w-page')).toBe('max-width:var(--container-page)');
        expect(css).toMatch(/--container-page:\s*90rem/u);
        expect(ruleFor(css, 'max-w-reading')).toBe('max-width:var(--container-reading)');
        expect(css).toMatch(/--container-reading:\s*40rem/u);
    });

    // `darkTheme.md` §6.1: the roles live in `@theme` (not `@theme inline`), so a role utility compiles to the VARIABLE
    // and the dark block's override re-themes it. Under `inline` the light value would be baked into the utility and
    // the dark block would silently do nothing.
    it('compiles a role utility to its variable, so the dark block re-themes it', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'bg-paper')).toBe('background-color:var(--color-paper)');
        expect(ruleFor(css, 'text-ink')).toBe('color:var(--color-ink)');
    });

    it('overrides the role variables in one prefers-color-scheme: dark block', async () => {
        const css = await cssPromise;

        expect(css).toMatch(/@media \(prefers-color-scheme:\s*dark\)\s*\{[^@]*--color-paper:\s*#172029/iu);
        expect(css).toMatch(/color-scheme:\s*light dark/u);
    });

    it('sets the card title at 1rem / 20 px leading / 600 from one utility', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'text-card-title')).toBe(
            'font-size:var(--text-card-title);line-height:var(--tw-leading,var(--text-card-title--line-height));font-weight:var(--tw-font-weight,var(--text-card-title--font-weight))',
        );
        expect(css).toMatch(/--text-card-title:\s*1rem/u);
        // REWRITTEN: it was the ratio 1.3 (20.8 px); the leading is 20 px, written as the unitless `calc(20 / 16)`.
        expect(css).toMatch(/--text-card-title--line-height:\s*calc\(20 \/ 16\)/u);
        expect(css).toMatch(/--text-card-title--font-weight:\s*600/u);
    });

    // REWRITTEN for the owner's type-scale ruling (2026-10-25): lists are 14 px, the unit scale's step (they were 13 px
    // / 1.35 under rule C5, which the owner found "rather small").
    it('sets the list role at 0.875rem / 20 px leading / 400 from one utility', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'text-list')).toBe(
            'font-size:var(--text-list);line-height:var(--tw-leading,var(--text-list--line-height));font-weight:var(--tw-font-weight,var(--text-list--font-weight))',
        );
        expect(css).toMatch(/--text-list:\s*0\.875rem/u);
        expect(css).toMatch(/--text-list--line-height:\s*calc\(20 \/ 14\);/u);
        expect(css).toMatch(/--text-list--font-weight:\s*400/u);
    });

    // REWRITTEN: the clamp's ceiling was 2.5rem (40 px). Owner rule C1 caps UI text at 28 px, so every container class
    // is 28 and the compiled clamp is bounded at 1.75rem on both ends (the source change was 60cf38d84).
    it('sizes the large title with a container-unit clamp bounded at 28 px', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'text-large-title')).toContain('font-size:var(--text-large-title)');
        expect(css).toMatch(/--text-large-title:\s*clamp\(1\.75rem,[^;]*cqi[^;]*1\.75rem\)/u);
    });

    // REWRITTEN: this asserted the overline's tracking. The role is retired and no role tracks its letters (owner
    // ruling 2026-10-25), so the compiled sheet carries no letter-spacing sub-property and no overline utility.
    it('tracks no role’s letters and has no overline utility', async () => {
        const css = await cssPromise;

        expect(css).not.toMatch(/--text-[a-z-]+--letter-spacing/u);
        expect(css).not.toMatch(/--text-overline/u);
        expect(ruleFor(css, 'text-label')).toContain('font-size:var(--text-label)');
    });

    it('resolves the colour roles to real utilities', async () => {
        const css = await cssPromise;

        expect(ruleFor(css, 'bg-paper')).toBe('background-color:var(--color-paper)');
        expect(ruleFor(css, 'text-ink-muted')).toBe('color:var(--color-ink-muted)');
        expect(ruleFor(css, 'border-line-control')).toBe('border-color:var(--color-line-control)');
        expect(ruleFor(css, 'bg-selected-fill')).toBe('background-color:var(--color-selected-fill)');
        expect(css).toMatch(/--color-line-control:\s*#80878F/iu);
    });

    it('declares the caption size once, not twice', async () => {
        expect((await cssPromise).match(/--text-caption:/gu)).toHaveLength(1);
    });
});

// `componentFixes.md` §10, §10a. `ring-offset-2` paints the gap between a control and its focus ring in
// `--tw-ring-offset-color`, which Tailwind registers with `inherits: false` and defaults to WHITE (a halo in dark). The
// gap is now the colour of the SURFACE the control sits on: a surface sets the INHERITING custom property `--cm-surface`
// (and `--cm-press`, the press fill), and a control reads them with a canvas fallback. That only works if the compiler
// emits them as plain inheriting properties, so it is asserted on the COMPILED stylesheet: only the compiler knows what
// a utility resolves to, and a registered `@property --cm-surface` (inherits: false by default) would silently break
// every control below its surface.
describe('the surface tone, compiled', () => {
    const squashed = (css: string): string => css.replace(/\s+/gu, '');

    it('gives a focus-visible ring a gap read from --cm-surface, falling back to the canvas role', async () => {
        const css = squashed(await compileAppCss());

        expect(css).toMatch(/:focus-visible\{[^}]*--tw-ring-offset-color:var\(--cm-surface,var\(--color-canvas\)\)/u);
        expect(css).toMatch(
            /:has\(:is\(:focus-visible\)\)\{[^}]*--tw-ring-offset-color:var\(--cm-surface,var\(--color-canvas\)\)/u,
        );
        // No control names the canvas as its fixed gap any more (a test that names the old class in prose may be scanned).
        expect(css).not.toContain('.focus-visible\\:ring-offset-canvas');
    });

    it('keeps the ring-offset colour property non-inheriting, which is why a control must name its own', async () => {
        expect(await compileAppCss()).toMatch(/@property --tw-ring-offset-color\s*\{[^}]*inherits:\s*false/u);
    });

    it('presses a hover, an active and a highlighted item to --cm-press, falling back to the canvas row', async () => {
        const css = squashed(await compileAppCss());
        const fill = 'background-color:var(--cm-press,var(--color-press-canvas))';

        expect(css).toMatch(new RegExp(`:hover\\{[^}]*${fill.replace(/[()]/gu, '\\$&')}`, 'u'));
        expect(css).toMatch(new RegExp(`:active\\{[^}]*${fill.replace(/[()]/gu, '\\$&')}`, 'u'));
        expect(css).toMatch(new RegExp(`\\[data-highlighted\\]\\{[^}]*${fill.replace(/[()]/gu, '\\$&')}`, 'u'));
    });

    it('lets a chip rest on the surface’s chip fill and press to its chip press, each with a fallback', async () => {
        const css = squashed(await compileAppCss());

        expect(css).toContain('background-color:var(--cm-chip-fill,var(--color-chip-fill-canvas))');
        expect(css).toContain('background-color:var(--cm-chip-press,var(--color-chip-press-canvas))');
    });

    // The fallback outside every surface names the CANVAS chip vars, so it must resolve in BOTH themes: a fallback that
    // named a light role would leave a chip on a dark page resting on the light fill.
    it('resolves the canvas chip fallback in the light block and again in the dark one', async () => {
        const css = squashed(await compileAppCss());
        const darkStart = css.indexOf('@media(prefers-color-scheme:dark)');
        const declared = (block: string, name: string): string | undefined =>
            new RegExp(`${name}:(#[0-9a-fA-F]{6})`, 'u').exec(block)?.[1]?.toLowerCase();

        expect(darkStart).toBeGreaterThan(0);

        for (const name of ['--color-chip-fill-canvas', '--color-chip-press-canvas']) {
            expect(declared(css.slice(0, darkStart), name), `${name} in light`).toBeDefined();
            expect(declared(css.slice(darkStart), name), `${name} in dark`).toBeDefined();
        }

        expect(declared(css.slice(0, darkStart), '--color-chip-fill-canvas')).toBe(role.surfaceMuted.toLowerCase());
        expect(declared(css.slice(darkStart), '--color-chip-fill-canvas')).toBe(roleDark.surfaceMuted.toLowerCase());
    });

    // §10b: a chip's fill is chosen per theme, so the compiled sheet gives paper-raised its own chip fill, and in the dark
    // block that fill is paper, not the surface-muted colour paper-raised itself paints there.
    it('gives a chip on paper-raised surface-muted in light and paper in dark', async () => {
        const css = squashed(await compileAppCss());
        const darkStart = css.indexOf('@media(prefers-color-scheme:dark)');
        const declared = (block: string): string | undefined =>
            /--color-chip-fill-paper-raised:(#[0-9a-fA-F]{6})/u.exec(block)?.[1]?.toLowerCase();

        expect(darkStart).toBeGreaterThan(0);
        expect(declared(css.slice(0, darkStart))).toBe(role.surfaceMuted.toLowerCase());
        expect(declared(css.slice(darkStart))).toBe(roleDark.paper.toLowerCase());
        expect(declared(css.slice(darkStart))).not.toBe(roleDark.paperRaised.toLowerCase());
    });

    it('paints each tone and sets its four properties to the roles of the table', async () => {
        const css = squashed(await compileAppCss());

        for (const [fillRole, tone] of [
            ['canvas', 'canvas'],
            ['paper', 'paper'],
            ['paper-overlay', 'paper-overlay'],
            ['paper-raised', 'paper-raised'],
            ['inverse', 'inverse'],
            ['surface-muted', 'muted'],
        ] as const) {
            expect(css, `${tone} fill`).toContain(`--cm-surface:var(--color-${fillRole})`);
            expect(css, `${tone} press`).toContain(`--cm-press:var(--color-press-${tone})`);
            expect(css, `${tone} chip fill`).toContain(`--cm-chip-fill:var(--color-chip-fill-${tone})`);
            expect(css, `${tone} chip press`).toContain(`--cm-chip-press:var(--color-chip-press-${tone})`);
        }
    });

    it('lets the Clerk card state the surface it paints from 480 up and the canvas again at the wide layout', async () => {
        const css = squashed(await compileAppCss());
        const at = (query: string, declaration: string): boolean =>
            new RegExp(`@media\\(${query}\\)\\{[^@]*?${declaration.replace(/[()]/gu, '\\$&')}`, 'u').test(css);

        expect(at('width>=480px', '--cm-surface:var(--color-paper)')).toBe(true);
        expect(at('width>=480px', '--cm-press:var(--color-press-paper)')).toBe(true);
        expect(at('width>=64rem', '--cm-surface:var(--color-canvas)')).toBe(true);
    });

    it('registers none of the tone properties, so they inherit down the tree', async () => {
        const css = await compileAppCss();

        for (const property of ['--cm-surface', '--cm-press', '--cm-chip-fill', '--cm-chip-press']) {
            expect(css, property).not.toMatch(new RegExp(`@property\\s+${property}`, 'u'));
        }
    });

    it('defines each press role in the light theme and again, re-themed, in the dark block', async () => {
        const css = await compileAppCss();
        const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');

        expect(darkAt).toBeGreaterThan(-1);

        for (const [tone, light, dark] of [
            ['canvas', '#d9dde1', '#293037'],
            ['paper', '#e5e6e9', '#303941'],
            ['paper-overlay', '#e8e8e9', '#3e4853'],
            ['paper-raised', '#e8e8e9', '#39434d'],
            ['inverse', '#2e3236', '#d2d6d9'],
            ['muted', '#d4d8dd', '#39434d'],
        ] as const) {
            expect(css.slice(0, darkAt), `${tone} light`).toContain(`--color-press-${tone}: ${light}`);
            expect(css.slice(darkAt), `${tone} dark`).toContain(`--color-press-${tone}: ${dark}`);
        }
    });

    it('draws the floating ring as a paperOverlay band inside a focusRing ring', async () => {
        const css = squashed(await compileAppCss());

        expect(css).toMatch(/:focus-visible\{[^}]*--tw-ring-offset-color:var\(--color-paper-overlay\)/u);
    });
});
