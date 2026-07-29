/**
 * Byte-identity guard for the web design tokens. U0 re-derives the `rem`/px token strings from the
 * single numeric source (`scale.ts`); the emitted values, their key order, AND the generated
 * `theme.css` (which Tailwind v4 consumes verbatim) MUST be unchanged. Golden literals below are the
 * pre-refactor output — any drift here is a visual change to the web app and fails the build on purpose.
 */
import { describe, expect, it } from 'vitest';

import { semantic } from '../colors.js';
import { glass } from '../gradients.js';
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
        const emitted = themeCss().match(/--color-glass-[\w-]+/g) ?? [];

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
 * Snapshots the REAL generator output. `themeCss` is the single authoritative composition that
 * `scripts/generate-theme.mjs` writes to `dist/theme.css`, so this is the strongest byte-identity proof
 * available without a build step: keys + values + order together, from the same code that ships.
 *
 * This test used to RE-IMPLEMENT the generator's emission loops, which meant it could not fail when the
 * generator drifted — the duplication is now gone and the assertion is honest.
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
              --color-slate: #636E72;
              --color-mist: #B2BEC3;
              --color-pearl: #F5F5F5;
              --color-white: #FFFFFF;
              --color-success: #4CAF7C;
              --color-warning: #F5B041;
              --color-error: #C05238;
              --color-error-dark: #B1442B;
              --color-premium: #D4A574;
              --color-background: #FAF6F0;
              --color-foreground: #2D3436;
              --color-card: #FFFFFF;
              --color-primary: #5BA8A0;
              --color-secondary: #E8917A;
              --color-muted: #F5F5F5;
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
          }
          "
        `);
    });
});
