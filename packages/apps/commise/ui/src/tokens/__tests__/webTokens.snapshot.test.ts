/**
 * Byte-identity guard for the web design tokens. U0 re-derives the `rem`/px token strings from the
 * single numeric source (`scale.ts`); the emitted values, their key order, AND the generated
 * `theme.css` (which Tailwind v4 consumes verbatim) MUST be unchanged. Golden literals below are the
 * pre-refactor output — any drift here is a visual change to the web app and fails the build on purpose.
 */
import { describe, expect, it } from 'vitest';

import { semantic } from '../colors.js';
import { gradient, gradientCss } from '../gradients.js';
import { radius } from '../radius.js';
import { shadows } from '../shadows.js';
import { size, space } from '../spacing.js';
import { themeCss } from '../themeCss.js';
import { fonts, fontSizes, fontWeights } from '../typography.js';

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
            sm: '0.5rem',
            md: '0.75rem',
            lg: '1.125rem',
            xl: '1.5rem',
            full: '9999px',
        });
    });

    it('shadows compose the exact CSS box-shadow strings (spread omitted when 0)', () => {
        expectExact(shadows, {
            sm: '0 1px 2px rgba(20,30,45,0.05)',
            md: '0 1px 2px rgba(20,30,45,0.05), 0 2px 8px rgba(20,30,45,0.05)',
            lg: '0 2px 4px rgba(10,20,30,0.08), 0 8px 22px rgba(10,20,30,0.12)',
            xl: '0 12px 30px rgba(10,20,30,0.18)',
            glow: '0 0 0 3px rgba(50,92,127,0.25)',
        });
    });

    it('fonts, fontSizes, fontWeights are unchanged (fontSizes REWRITTEN for the 14/16/18/28 ruling, 2026-10-25)', () => {
        expectExact(fonts, {
            display: '"Manrope", Inter, system-ui, sans-serif',
            body: 'Inter, system-ui, sans-serif',
            mono: '"JetBrains Mono", monospace',
        });
        expectExact(fontSizes, {
            'display-md': '1.75rem',
            'heading-lg': '1.125rem',
            'heading-md': '1.125rem',
            'heading-sm': '1.125rem',
            'body-lg': '1.125rem',
            'body-md': '1rem',
            'body-sm': '0.875rem',
            caption: '0.875rem',
        });
        expectExact(fontWeights, { normal: '400', medium: '500', semibold: '600', bold: '600' });
    });

    // REWRITTEN for the redesign: `semantic.border` follows the `lineDivider` role (it was the shared subtle-border string).
    it('semantic.border resolves to the divider colour', () => {
        expect(semantic.border).toBe('#DFE3E8');
    });
});

/** Owner D12: no card is glass, so the theme emits no glass colour for one to read (`evaluateFinal.md` F1). */
describe('web tokens — no glass colours', () => {
    it('emits no --color-glass-* property in either theme', () => {
        expect(themeCss()).not.toMatch(/--color-glass-/u);
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

        // `brand` already reaches the web as the Button's `from-steel to-ocean-dark` classes and `scrim` as
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
 * Re-baselined for the REDESIGN (steel on a cool base, dusk dark mode; deliberately, from the design session's sources
 * pinned value by value in `redesignPin.test.ts`): the palette is renamed and recoloured, the roles and cover tints change
 * in both themes, the radii are 8/12/18/24, the shadows are cool and layered, the canvas wash is flat, and the dark block
 * also overrides the semantic names and the PRO chip.
 *
 * Earlier re-baseline, for the UI overhaul's slice 1 (`docs/architecture/uiOverhaulBlueprint.md`, Part B): the palette gains
 * `pewter` and `honey`, and the colour roles, type roles, breakpoints and container widths are appended after the
 * glass and canvas declarations. No pre-existing declaration changed its value or its relative order.
 */
describe('web tokens — generated theme.css artifact', () => {
    it('renders byte-identical Tailwind theme.css', () => {
        expect(themeCss()).toMatchInlineSnapshot(`
          "@import "tailwindcss";

          @theme {
              --color-steel: #325C7F;
              --color-steel-light: #96BCDE;
              --color-cream: #F7E9D7;
              --color-sky: #DDEEFC;
              --color-fog: #EFF3F6;
              --color-ocean-dark: #264A68;
              --color-charcoal: #171B20;
              --color-slate: #5C646E;
              --color-mist: #DFE3E8;
              --color-pearl: #E9EDF2;
              --color-cloud: #FCFDFF;
              --color-snow: #FFFFFF;
              --color-success: #4CAF7C;
              --color-warning: #F5B041;
              --color-warning-dark: #8C5A00;
              --color-error: #C05238;
              --color-error-dark: #A53E27;
              --color-pewter: #80878F;
              --color-background: #EFF3F6;
              --color-foreground: #171B20;
              --color-card: #FCFDFF;
              --color-primary: #325C7F;
              --color-secondary: #E9EDF2;
              --color-muted: #E9EDF2;
              --color-accent: #E4EEF7;
              --color-destructive: #C05238;
              --color-border: #DFE3E8;
              --color-ring: #325C7F;
              --font-display: "Manrope", Inter, system-ui, sans-serif;
              --font-body: Inter, system-ui, sans-serif;
              --font-mono: "JetBrains Mono", monospace;
              --text-display-md: 1.75rem;
              --text-heading-lg: 1.125rem;
              --text-heading-md: 1.125rem;
              --text-heading-sm: 1.125rem;
              --text-body-lg: 1.125rem;
              --text-body-md: 1rem;
              --text-body-sm: 0.875rem;
              --text-caption: 0.875rem;
              --font-weight-normal: 400;
              --font-weight-medium: 500;
              --font-weight-semibold: 600;
              --font-weight-bold: 600;
              --radius-sm: 0.5rem;
              --radius-md: 0.75rem;
              --radius-lg: 1.125rem;
              --radius-xl: 1.5rem;
              --radius-full: 9999px;
              --shadow-sm: 0 1px 2px rgba(20,30,45,0.05);
              --shadow-md: 0 1px 2px rgba(20,30,45,0.05), 0 2px 8px rgba(20,30,45,0.05);
              --shadow-lg: 0 2px 4px rgba(10,20,30,0.08), 0 8px 22px rgba(10,20,30,0.12);
              --shadow-xl: 0 12px 30px rgba(10,20,30,0.18);
              --shadow-glow: 0 0 0 3px rgba(50,92,127,0.25);
              --background-image-hero: linear-gradient(180deg, #EFF3F6 0%, #EFF3F6 100%);
              --color-canvas: #EFF3F6;
              --color-paper: #FCFDFF;
              --color-ink: #171B20;
              --color-ink-muted: #5C646E;
              --color-line-control: #80878F;
              --color-line-divider: #DFE3E8;
              --color-action: #325C7F;
              --color-action-text: #325C7F;
              --color-selected-fill: #E4EEF7;
              --color-selected-edge: #325C7F;
              --color-here-bar: #325C7F;
              --color-focus-ring: #325C7F;
              --color-rating: #171B20;
              --color-attention: #8C5A00;
              --color-attention-tint: rgba(245, 176, 65, 0.2);
              --color-danger: #C05238;
              --color-danger-text: #A53E27;
              --color-paper-raised: #FFFFFF;
              --color-paper-overlay: #FFFFFF;
              --color-surface-muted: #E9EDF2;
              --color-inverse: #171B20;
              --color-inverse-ink: #FFFFFF;
              --color-inverse-action: #96BCDE;
              --color-photo-chip: rgba(252, 253, 255, 0.94);
              --color-scrim: rgba(10, 16, 24, 0.42);
              --color-on-action: #FFFFFF;
              --color-action-pressed: #264A68;
              --color-danger-pressed: #A33F2A;
              --color-press-canvas: #d9dde1;
              --color-press-paper: #e5e6e9;
              --color-press-paper-raised: #e8e8e9;
              --color-press-paper-overlay: #e8e8e9;
              --color-press-muted: #d4d8dd;
              --color-press-inverse: #2e3236;
              --color-chip-fill-canvas: #E9EDF2;
              --color-chip-press-canvas: #d4d8dd;
              --color-chip-fill-paper: #E9EDF2;
              --color-chip-press-paper: #d4d8dd;
              --color-chip-fill-paper-raised: #E9EDF2;
              --color-chip-press-paper-raised: #d4d8dd;
              --color-chip-fill-paper-overlay: #E9EDF2;
              --color-chip-press-paper-overlay: #d4d8dd;
              --color-chip-fill-muted: #FCFDFF;
              --color-chip-press-muted: #e5e6e9;
              --color-chip-fill-inverse: #E9EDF2;
              --color-chip-press-inverse: #d4d8dd;
              --text-large-title: clamp(1.75rem, 1.75rem + 0cqi, 1.75rem);
              --text-large-title--line-height: calc(32 / 28);
              --text-large-title--font-weight: 600;
              --text-bar-title: 1rem;
              --text-bar-title--line-height: calc(20 / 16);
              --text-bar-title--font-weight: 600;
              --text-section-title: 1.125rem;
              --text-section-title--line-height: calc(24 / 18);
              --text-section-title--font-weight: 600;
              --text-card-title: 1rem;
              --text-card-title--line-height: calc(20 / 16);
              --text-card-title--font-weight: 600;
              --text-body: 1rem;
              --text-body--line-height: calc(24 / 16);
              --text-body--font-weight: 400;
              --text-reading-body: 1.125rem;
              --text-reading-body--line-height: calc(28 / 18);
              --text-reading-body--font-weight: 400;
              --text-meta: 0.875rem;
              --text-meta--line-height: calc(20 / 14);
              --text-meta--font-weight: 400;
              --text-list: 0.875rem;
              --text-list--line-height: calc(20 / 14);
              --text-list--font-weight: 400;
              --text-label: 0.875rem;
              --text-label--line-height: calc(20 / 14);
              --text-label--font-weight: 600;
              --text-caption--line-height: calc(20 / 14);
              --text-caption--font-weight: 500;
              --text-figure-stat: 1.125rem;
              --text-figure-stat--line-height: calc(24 / 18);
              --text-figure-stat--font-weight: 600;
              --breakpoint-medium: 37.5rem;
              --breakpoint-nav: 52.5rem;
              --container-regular: 37.5rem;
              --container-wide: 60rem;
              --container-reading: 40rem;
              --container-list: 48rem;
              --container-detail: 72rem;
              --container-page: 90rem;
              --pinned-bar-height: 3.5rem;
              --pinned-bar-block: calc(var(--pinned-bar-height) + env(safe-area-inset-top));
              --color-cover-steel: #E1EDFA;
              --color-cover-cream: #F7E9D7;
              --color-cover-sky: #DDEEFC;
              --color-cover-peach: #F5E9DF;
              --color-cover-success: #E4EDF2;
              --color-cover-warning: #F7E9D7;
              --color-pro-fill: #5C646E;
              --color-pro-ink: #FFFFFF;
              --color-difficulty-easy-fill: #FCFDFF;
              --color-difficulty-easy-ink: #5C646E;
              --color-difficulty-medium-fill: #FCFDFF;
              --color-difficulty-medium-ink: #5C646E;
              --color-difficulty-hard-fill: #FCFDFF;
              --color-difficulty-hard-ink: #5C646E;
              --color-bar: rgba(252, 253, 255, 0.92);
              --animate-section-enter: section-enter 400ms ease-out both;
              --animate-pending-bar-reveal: pending-bar-reveal 0s linear both;
          }

          @keyframes section-enter {
              from {
                  opacity: 0;
                  transform: translateY(0.5rem);
              }

              to {
                  opacity: 1;
                  transform: none;
              }
          }

          @keyframes pending-bar-reveal {
              from {
                  opacity: 0;
              }

              to {
                  opacity: 1;
              }
          }

          @media (prefers-color-scheme: dark) {
              :root {
                  --color-canvas: #0E161E;
                  --color-paper: #172029;
                  --color-paper-raised: #212B36;
                  --color-paper-overlay: #26313D;
                  --color-surface-muted: #212B36;
                  --color-ink: #EBEFF2;
                  --color-ink-muted: #A3ACB6;
                  --color-line-control: #7D8792;
                  --color-line-divider: #262F38;
                  --color-action: #96BCDE;
                  --color-action-text: #96BCDE;
                  --color-on-action: #0E161E;
                  --color-action-pressed: #B4CFE8;
                  --color-danger-pressed: #CC6A52;
                  --color-selected-fill: #1F3548;
                  --color-selected-edge: #96BCDE;
                  --color-here-bar: #96BCDE;
                  --color-focus-ring: #96BCDE;
                  --color-rating: #EBEFF2;
                  --color-attention: #EFBA64;
                  --color-attention-tint: rgba(245, 176, 65, 0.2);
                  --color-danger: #E07A60;
                  --color-danger-text: #EC8E76;
                  --color-inverse: #EBEFF2;
                  --color-inverse-ink: #171B20;
                  --color-inverse-action: #325C7F;
                  --color-photo-chip: rgba(23, 32, 41, 0.86);
                  --color-scrim: rgba(0, 0, 0, 0.66);
                  --color-press-canvas: #293037;
                  --color-press-paper: #303941;
                  --color-press-paper-raised: #39434d;
                  --color-press-paper-overlay: #3e4853;
                  --color-press-muted: #39434d;
                  --color-press-inverse: #d2d6d9;
                  --color-chip-fill-canvas: #212B36;
                  --color-chip-press-canvas: #39434d;
                  --color-chip-fill-paper: #212B36;
                  --color-chip-press-paper: #39434d;
                  --color-chip-fill-paper-raised: #172029;
                  --color-chip-press-paper-raised: #303941;
                  --color-chip-fill-paper-overlay: #212B36;
                  --color-chip-press-paper-overlay: #39434d;
                  --color-chip-fill-muted: #172029;
                  --color-chip-press-muted: #303941;
                  --color-chip-fill-inverse: #212B36;
                  --color-chip-press-inverse: #39434d;
                  --color-background: #0E161E;
                  --color-foreground: #EBEFF2;
                  --color-card: #172029;
                  --color-primary: #96BCDE;
                  --color-secondary: #212B36;
                  --color-muted: #212B36;
                  --color-accent: #1F3548;
                  --color-destructive: #E07A60;
                  --color-border: #262F38;
                  --color-ring: #96BCDE;
                  --color-pro-fill: #A3ACB6;
                  --color-pro-ink: #171B20;
                  --color-cover-steel: #202B37;
                  --color-cover-cream: #342817;
                  --color-cover-sky: #1C2C38;
                  --color-cover-peach: #32281F;
                  --color-cover-success: #232B30;
                  --color-cover-warning: #342817;
                  --color-difficulty-easy-fill: #172029;
                  --color-difficulty-easy-ink: #A3ACB6;
                  --color-difficulty-medium-fill: #172029;
                  --color-difficulty-medium-ink: #A3ACB6;
                  --color-difficulty-hard-fill: #172029;
                  --color-difficulty-hard-ink: #A3ACB6;
                  --background-image-hero: linear-gradient(180deg, #0E161E 0%, #0E161E 100%);
                  --color-bar: rgba(23, 32, 41, 0.94);
              }
          }

          :root {
              color-scheme: light dark;
          }
          "
        `);
    });
});
