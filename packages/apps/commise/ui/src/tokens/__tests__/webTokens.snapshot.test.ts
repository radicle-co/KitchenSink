/**
 * Byte-identity guard for the web design tokens. U0 re-derives the `rem`/px token strings from the
 * single numeric source (`scale.ts`); the emitted values, their key order, AND the generated
 * `theme.css` (which Tailwind v4 consumes verbatim) MUST be unchanged. Golden literals below are the
 * pre-refactor output — any drift here is a visual change to the web app and fails the build on purpose.
 */
import { describe, expect, it } from 'vitest';

import { semantic } from '../colors.js';
import { glass, gradient, gradientCss } from '../gradients.js';
import { radius } from '../radius.js';
import { shadows } from '../shadows.js';
import { size, space } from '../spacing.js';
import { themeCss } from '../themeCss.js';
import { fonts, fontSizes, fontWeights, lineHeights } from '../typography.js';

/** Value + insertion-order assertion (Tailwind emission is order-sensitive via `Object.entries`). */
function expectExact(actual: Record<string, unknown>, golden: Record<string, unknown>): void {
    expect(actual).toEqual(golden);
    expect(Object.keys(actual)).toEqual(Object.keys(golden));
}

describe('web tokens — byte-identical values and order', () => {
    it('space is the unit-aware rem ramp (unitless 0)', () => {
        expectExact(space, {
            0: 0,
            1: '0.25rem',
            2: '0.5rem',
            3: '0.75rem',
            4: '1rem',
            5: '1.5rem',
            6: '2rem',
            7: '3rem',
            8: '4rem',
            9: '6rem',
        });
    });

    it('size matches space exactly', () => {
        expectExact(size, {
            0: 0,
            1: '0.25rem',
            2: '0.5rem',
            3: '0.75rem',
            4: '1rem',
            5: '1.5rem',
            6: '2rem',
            7: '3rem',
            8: '4rem',
            9: '6rem',
        });
    });

    it('radius emits rem, but the `full` pill sentinel stays px', () => {
        expectExact(radius, {
            sm: '0.375rem',
            md: '0.75rem',
            lg: '1.25rem',
            xl: '1.75rem',
            full: '9999px',
        });
    });

    it('shadows compose the exact CSS box-shadow strings (spread omitted when 0)', () => {
        expectExact(shadows, {
            sm: '0 1px 3px rgba(45,52,54,0.04)',
            md: '0 4px 6px -1px rgba(45,52,54,0.07)',
            lg: '0 10px 15px -3px rgba(45,52,54,0.08)',
            xl: '0 20px 25px -5px rgba(45,52,54,0.09)',
            glow: '0 0 32px rgba(49,128,122,0.25)',
        });
    });

    it('fonts, fontSizes, lineHeights, fontWeights are unchanged', () => {
        expectExact(fonts, {
            display: '"Playfair Display", Georgia, serif',
            body: 'Inter, system-ui, sans-serif',
            mono: '"JetBrains Mono", monospace',
        });
        expectExact(fontSizes, {
            'display-xl': '3rem',
            'display-lg': '2.25rem',
            'display-md': '1.75rem',
            'heading-lg': '1.5rem',
            'heading-md': '1.25rem',
            'heading-sm': '1.125rem',
            'body-lg': '1.125rem',
            'body-md': '1rem',
            'body-sm': '0.875rem',
            caption: '0.75rem',
            overline: '0.6875rem',
        });
        expectExact(lineHeights, { heading: '1.2', body: '1.5', caption: '1.4' });
        expectExact(fontWeights, { normal: '400', medium: '500', semibold: '600', bold: '700' });
    });

    it('semantic.border still resolves to the subtle border colour', () => {
        expect(semantic.border).toBe('rgba(178, 190, 195, 0.3)');
    });
});

/**
 * The frosted-glass HAIRLINE must reach the web as a token-derived Tailwind utility.
 *
 * `glass.{tier}.border` is the translucent-white edge that gives a glass pane its lit rim. Native already
 * consumes it through `toNativeGlass(...).border`; the web had no path to it at all, because the theme
 * generator never read `gradients.ts` — so every web glass surface re-spelled the value as a literal
 * (`border-white/30`). Same knowledge, two representations, and it had already drifted (one surface says
 * `/20`). Emitting it as a `--color-*` custom property gives Tailwind a real `border-glass-*-edge` utility,
 * which — unlike an inline style — composes with `hover:` variants and cannot silently out-specify them.
 *
 * The assertions below are derived from the token, never from a literal: re-tone the glass and they follow.
 */
describe('web tokens — the glass hairline is emitted, not re-spelled', () => {
    it('emits a border utility for every glass tier, valued from the token', () => {
        const css = themeCss();

        for (const [tier, spec] of Object.entries(glass)) {
            expect(css).toContain(`--color-glass-${tier}-edge: ${spec.border};`);
        }
    });

    it('emits one edge per tier and no others (no hand-added glass colours)', () => {
        // Distinct names: the dark block overrides the same properties (`themeCssDark.test.ts`), it adds none.
        const emitted = [...new Set(themeCss().match(/--color-glass-[\w-]+/g) ?? [])];

        expect(emitted).toEqual(Object.keys(glass).map((tier) => `--color-glass-${tier}-edge`));
    });

    it('does NOT emit the glass fill/blur/saturate as custom properties', () => {
        const css = themeCss();

        // Those three already reach the web through `toWebGlass` as inline declarations. Emitting them here
        // as well would create a SECOND web path for the same knowledge — the opposite of the fix. Only the
        // edge is emitted, because only the edge needs to live in class position (border-width composition
        // and `hover:` variants).
        expect(css).not.toContain('--color-glass-card-surface');
        expect(css).not.toContain('--blur-glass-card');
        expect(css).not.toContain('--color-glass-card-fallback');
    });
});

/**
 * The page-canvas gradient must reach the web as a REAL Tailwind utility namespace.
 *
 * `gradient.hero` is the wireframes' `--gradient-beach-glow` — the wash every one of the nine screens paints
 * on `body`. Native consumes it through `GradientSurface`/`toNativeGradient`; the web canvas can only consume
 * it from STYLESHEET position (`@layer base { body { … } }` — a `<body>` background cannot come from a React
 * inline style), so unlike the glass fill it has to be emitted here.
 *
 * `--background-image-*` is the namespace Tailwind v4 actually uses for `bg-*` image utilities — VERIFIED by
 * compiling it, not assumed (`web/tests/__integration__/tailwindTheme.integration.test.ts` reads the real
 * declaration). This is the `--font-size-*`/`--line-height-*` trap: a plausible-looking prefix such as
 * `--gradient-*` is NOT a namespace, so it would emit a `:root` property that generates NO utility at all —
 * exactly how the DS type ramp once compiled to nothing across 324 call sites. Adding a NAMED key to a
 * namespace is also not the `--spacing-*` hijack: it defines `bg-hero` and redefines nothing built-in.
 */
describe('web tokens — the page-canvas gradient is emitted into a real namespace', () => {
    it('emits the hero canvas gradient, valued from the token', () => {
        expect(themeCss()).toContain(`--background-image-hero: ${gradientCss(gradient.hero)};`);
    });

    it('emits it under --background-image-* and NOT under a non-namespace prefix', () => {
        const css = themeCss();

        expect(css).toMatch(/--background-image-[a-z-]+\s*:/);
        // `--gradient-*` is not a Tailwind namespace: it would round-trip as a custom property and generate
        // no `bg-*` utility, which is indistinguishable from the token never shipping.
        expect(css).not.toMatch(/--gradient-[a-z-]+\s*:/);
    });

    it('emits ONLY the canvas gradient, so the CTA/scrim ramps keep one representation each', () => {
        // Distinct names: the dark block overrides `--background-image-hero` rather than adding a second ramp.
        const emitted = [...new Set(themeCss().match(/--background-image-[\w-]+/g) ?? [])];

        // `brand` already reaches the web as the Button's `from-seafoam to-ocean-dark` classes and `scrim` as
        // the recipe-detail cover's own classes. Emitting them here too would be a SECOND web path for the
        // same knowledge — the duplication this module exists to remove.
        expect(emitted).toEqual(['--background-image-hero']);
    });
});

/**
 * Snapshots the REAL generator output. `themeCss` is the single authoritative composition that
 * `scripts/generateTheme.mjs` writes to `dist/theme.css`, so this is the strongest byte-identity proof
 * available without a build step: keys + values + order together, from the same code that ships.
 *
 * This test used to RE-IMPLEMENT the generator's emission loops, which meant it could not fail when the
 * generator drifted — the duplication is now gone and the assertion is honest.
 *
 * Re-baselined for the UI overhaul's slice 1 (`docs/architecture/uiOverhaulBlueprint.md`, Part B): the palette gains
 * `pewter` and `honey`, and the colour roles, type roles, breakpoints and container widths are appended after the
 * glass and canvas declarations. No pre-existing declaration changed its value or its relative order.
 */
describe('web tokens — generated theme.css artifact', () => {
    it('renders byte-identical Tailwind theme.css', () => {
        expect(themeCss()).toMatchInlineSnapshot(`
          "@import "tailwindcss";

          @theme {
              --color-seafoam: #31807A;
              --color-seafoam-light: #5BA8A0;
              --color-coral: #E8917A;
              --color-sky: #8ECAE6;
              --color-sand: #FAF6F0;
              --color-ocean-dark: #2A6B65;
              --color-charcoal: #2D3436;
              --color-slate: #6B645C;
              --color-mist: #C9C1B6;
              --color-pearl: #F3EEE6;
              --color-white: #FFFFFF;
              --color-success: #4CAF7C;
              --color-warning: #F5B041;
              --color-warning-dark: #8C5A00;
              --color-error: #C05238;
              --color-error-dark: #B1442B;
              --color-premium: #D4A574;
              --color-pewter: #8A847C;
              --color-honey: #A86A12;
              --color-background: #FAF6F0;
              --color-foreground: #2D3436;
              --color-card: #FFFFFF;
              --color-primary: #5BA8A0;
              --color-secondary: #E8917A;
              --color-muted: #F3EEE6;
              --color-accent: #8ECAE6;
              --color-destructive: #C05238;
              --color-border: rgba(178, 190, 195, 0.3);
              --color-ring: #5BA8A0;
              --font-display: "Playfair Display", Georgia, serif;
              --font-body: Inter, system-ui, sans-serif;
              --font-mono: "JetBrains Mono", monospace;
              --text-display-xl: 3rem;
              --text-display-lg: 2.25rem;
              --text-display-md: 1.75rem;
              --text-heading-lg: 1.5rem;
              --text-heading-md: 1.25rem;
              --text-heading-sm: 1.125rem;
              --text-body-lg: 1.125rem;
              --text-body-md: 1rem;
              --text-body-sm: 0.875rem;
              --text-caption: 0.75rem;
              --text-overline: 0.6875rem;
              --leading-heading: 1.2;
              --leading-body: 1.5;
              --leading-caption: 1.4;
              --font-weight-normal: 400;
              --font-weight-medium: 500;
              --font-weight-semibold: 600;
              --font-weight-bold: 700;
              --radius-sm: 0.375rem;
              --radius-md: 0.75rem;
              --radius-lg: 1.25rem;
              --radius-xl: 1.75rem;
              --radius-full: 9999px;
              --shadow-sm: 0 1px 3px rgba(45,52,54,0.04);
              --shadow-md: 0 4px 6px -1px rgba(45,52,54,0.07);
              --shadow-lg: 0 10px 15px -3px rgba(45,52,54,0.08);
              --shadow-xl: 0 20px 25px -5px rgba(45,52,54,0.09);
              --shadow-glow: 0 0 32px rgba(49,128,122,0.25);
              --color-glass-card-edge: rgba(255, 255, 255, 0.3);
              --color-glass-subtle-edge: rgba(255, 255, 255, 0.3);
              --background-image-hero: linear-gradient(135deg, #FAF6F0 0%, #F0F7F4 50%, #E8F4F8 100%);
              --color-canvas: #FAF6F0;
              --color-paper: #FFFFFF;
              --color-ink: #2D3436;
              --color-ink-muted: #6B645C;
              --color-line-control: #8A847C;
              --color-line-divider: #C9C1B6;
              --color-action: #31807A;
              --color-action-text: #2A6B65;
              --color-selected-fill: #E2EDEC;
              --color-selected-edge: #31807A;
              --color-here-bar: #31807A;
              --color-focus-ring: #2A6B65;
              --color-rating: #A86A12;
              --color-attention: #8C5A00;
              --color-attention-tint: rgba(245, 176, 65, 0.2);
              --color-danger: #C05238;
              --color-danger-text: #B1442B;
              --color-paper-raised: #FFFFFF;
              --color-paper-overlay: #FFFFFF;
              --color-surface-muted: #F3EEE6;
              --color-inverse: #2D3436;
              --color-inverse-ink: #FFFFFF;
              --color-inverse-action: #5BA8A0;
              --color-photo-chip: rgba(255, 255, 255, 0.92);
              --color-scrim: rgba(45, 52, 54, 0.4);
              --color-on-action: #FFFFFF;
              --color-action-pressed: #2A6B65;
              --text-large-title: clamp(1.75rem, 1.5rem + 1.6667cqi, 2.5rem);
              --text-large-title--line-height: 1.15;
              --text-large-title--font-weight: 700;
              --text-bar-title: 1.0625rem;
              --text-bar-title--line-height: 1.2;
              --text-bar-title--font-weight: 600;
              --text-section-title: 1.125rem;
              --text-section-title--line-height: 1.25;
              --text-section-title--font-weight: 600;
              --text-card-title: 1rem;
              --text-card-title--line-height: 1.3;
              --text-card-title--font-weight: 600;
              --text-body: 1rem;
              --text-body--line-height: 1.5;
              --text-body--font-weight: 400;
              --text-reading-body: 1.125rem;
              --text-reading-body--line-height: 1.6;
              --text-reading-body--font-weight: 400;
              --text-meta: 0.875rem;
              --text-meta--line-height: 1.4;
              --text-meta--font-weight: 400;
              --text-label: 0.875rem;
              --text-label--line-height: 1.2;
              --text-label--font-weight: 600;
              --text-caption--line-height: 1.4;
              --text-caption--font-weight: 500;
              --text-overline--line-height: 1.4;
              --text-overline--font-weight: 600;
              --text-overline--letter-spacing: 0.06em;
              --text-figure-stat: 1.25rem;
              --text-figure-stat--line-height: 1.2;
              --text-figure-stat--font-weight: 600;
              --breakpoint-medium: 37.5rem;
              --breakpoint-nav: 52.5rem;
              --container-regular: 37.5rem;
              --container-wide: 60rem;
              --container-reading: 40rem;
              --container-list: 48rem;
              --container-detail: 72rem;
              --container-page: 90rem;
              --color-cover-seafoam: #E6F0EF;
              --color-cover-coral: #FAE9E4;
              --color-cover-sky: #DFF0F8;
              --color-cover-premium: #F6EBE0;
              --color-cover-success: #E2F2EA;
              --color-cover-warning: #FDEFD9;
              --color-pro-fill: #D4A574;
              --color-pro-ink: #2D3436;
              --color-difficulty-easy-fill: rgba(76, 175, 124, 0.15);
              --color-difficulty-easy-ink: #2A6B65;
              --color-difficulty-medium-fill: rgba(245, 176, 65, 0.15);
              --color-difficulty-medium-ink: #8C5A00;
              --color-difficulty-hard-fill: rgba(232, 145, 122, 0.15);
              --color-difficulty-hard-ink: #2D3436;
              --color-bar: rgba(255, 255, 255, 0.92);
          }

          @media (prefers-color-scheme: dark) {
              :root {
                  --color-canvas: #141210;
                  --color-paper: #1E1B18;
                  --color-paper-raised: #272320;
                  --color-paper-overlay: #302C28;
                  --color-surface-muted: #2B2825;
                  --color-ink: #EDE9E4;
                  --color-ink-muted: #B6B0A9;
                  --color-line-control: #857F79;
                  --color-line-divider: #3B3734;
                  --color-action: #31807A;
                  --color-action-text: #7DC7C0;
                  --color-on-action: #FFFFFF;
                  --color-action-pressed: #2A6B65;
                  --color-selected-fill: #243935;
                  --color-selected-edge: #65B5AE;
                  --color-here-bar: #65B5AE;
                  --color-focus-ring: #7DC7C0;
                  --color-rating: #EAA950;
                  --color-attention: #EFBA64;
                  --color-attention-tint: rgba(245, 176, 65, 0.2);
                  --color-danger: #C05238;
                  --color-danger-text: #EC8E76;
                  --color-inverse: #EDE9E4;
                  --color-inverse-ink: #2D3436;
                  --color-inverse-action: #2A6B65;
                  --color-photo-chip: rgba(48, 44, 40, 0.92);
                  --color-scrim: rgba(0, 0, 0, 0.6);
                  --color-cover-seafoam: #22312E;
                  --color-cover-coral: #4A352E;
                  --color-cover-sky: #374245;
                  --color-cover-premium: #46392C;
                  --color-cover-success: #283C2E;
                  --color-cover-warning: #4D3C21;
                  --color-difficulty-easy-fill: rgba(76, 175, 124, 0.18);
                  --color-difficulty-easy-ink: #7DC7C0;
                  --color-difficulty-medium-fill: rgba(245, 176, 65, 0.18);
                  --color-difficulty-medium-ink: #EFBA64;
                  --color-difficulty-hard-fill: rgba(232, 145, 122, 0.18);
                  --color-difficulty-hard-ink: #EDE9E4;
                  --color-glass-card-edge: rgba(255, 255, 255, 0.12);
                  --color-glass-subtle-edge: rgba(255, 255, 255, 0.12);
                  --background-image-hero: linear-gradient(135deg, #141210 0%, #101714 50%, #0F181A 100%);
                  --color-bar: rgba(39, 35, 32, 0.94);
              }
          }

          :root {
              color-scheme: light dark;
          }
          "
        `);
    });
});
