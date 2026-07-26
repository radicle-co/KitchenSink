/**
 * Byte-identity guard for the web design tokens. U0 re-derives the `rem`/px token strings from the
 * single numeric source (`scale.ts`); the emitted values, their key order, AND the generated
 * `theme.css` (which Tailwind v4 consumes verbatim) MUST be unchanged. Golden literals below are the
 * pre-refactor output — any drift here is a visual change to the web app and fails the build on purpose.
 */
import { describe, expect, it } from 'vitest';

import { palette, semantic } from '../colors.js';
import { radius } from '../radius.js';
import { shadows } from '../shadows.js';
import { size, space } from '../spacing.js';
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
            glow: '0 0 32px rgba(61,139,133,0.25)',
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
 * Reproduces `scripts/generate-theme.mjs` exactly against the (post-refactor) token objects and
 * snapshots the result. This is the strongest byte-identity proof: it captures the actual Tailwind
 * `theme.css` artifact the web app ships, keys + values + order together.
 */
function renderThemeCss(): string {
    const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const lines: string[] = ['@import "tailwindcss";', '', '@theme {'];

    for (const [k, v] of Object.entries(palette)) {
        lines.push(`    --color-${kebab(k)}: ${v};`);
    }

    for (const [k, v] of Object.entries(semantic)) {
        lines.push(`    --color-${kebab(k)}: ${v};`);
    }

    for (const [k, v] of Object.entries(fonts)) {
        lines.push(`    --font-${kebab(k)}: ${v};`);
    }

    for (const [k, v] of Object.entries(fontSizes)) {
        lines.push(`    --font-size-${kebab(k)}: ${v};`);
    }

    for (const [k, v] of Object.entries(lineHeights)) {
        lines.push(`    --line-height-${kebab(k)}: ${v};`);
    }

    for (const [k, v] of Object.entries(fontWeights)) {
        lines.push(`    --font-weight-${kebab(k)}: ${v};`);
    }

    for (const [k, v] of Object.entries(space)) {
        lines.push(`    --spacing-${k}: ${v};`);
    }

    for (const [k, v] of Object.entries(radius)) {
        lines.push(`    --radius-${k}: ${v};`);
    }

    for (const [k, v] of Object.entries(shadows)) {
        lines.push(`    --shadow-${k}: ${v};`);
    }

    lines.push('}');

    return lines.join('\n') + '\n';
}

describe('web tokens — generated theme.css artifact', () => {
    it('renders byte-identical Tailwind theme.css', () => {
        expect(renderThemeCss()).toMatchInlineSnapshot(`
          "@import "tailwindcss";

          @theme {
              --color-seafoam: #3D8B85;
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
              --color-error: #E17055;
              --color-premium: #D4A574;
              --color-background: #FAF6F0;
              --color-foreground: #2D3436;
              --color-card: #FFFFFF;
              --color-primary: #5BA8A0;
              --color-secondary: #E8917A;
              --color-muted: #F5F5F5;
              --color-accent: #8ECAE6;
              --color-destructive: #E17055;
              --color-border: rgba(178, 190, 195, 0.3);
              --color-ring: #5BA8A0;
              --font-display: "Playfair Display", Georgia, serif;
              --font-body: Inter, system-ui, sans-serif;
              --font-mono: "JetBrains Mono", monospace;
              --font-size-display-xl: 3rem;
              --font-size-display-lg: 2.25rem;
              --font-size-display-md: 1.75rem;
              --font-size-heading-lg: 1.5rem;
              --font-size-heading-md: 1.25rem;
              --font-size-heading-sm: 1.125rem;
              --font-size-body-lg: 1.125rem;
              --font-size-body-md: 1rem;
              --font-size-body-sm: 0.875rem;
              --font-size-caption: 0.75rem;
              --font-size-overline: 0.6875rem;
              --line-height-heading: 1.2;
              --line-height-body: 1.5;
              --line-height-caption: 1.4;
              --font-weight-normal: 400;
              --font-weight-medium: 500;
              --font-weight-semibold: 600;
              --font-weight-bold: 700;
              --spacing-0: 0;
              --spacing-1: 0.25rem;
              --spacing-2: 0.5rem;
              --spacing-3: 0.75rem;
              --spacing-4: 1rem;
              --spacing-5: 1.5rem;
              --spacing-6: 2rem;
              --spacing-7: 3rem;
              --spacing-8: 4rem;
              --spacing-9: 6rem;
              --radius-sm: 0.375rem;
              --radius-md: 0.75rem;
              --radius-lg: 1.25rem;
              --radius-xl: 1.75rem;
              --radius-full: 9999px;
              --shadow-sm: 0 1px 3px rgba(45,52,54,0.04);
              --shadow-md: 0 4px 6px -1px rgba(45,52,54,0.07);
              --shadow-lg: 0 10px 15px -3px rgba(45,52,54,0.08);
              --shadow-xl: 0 20px 25px -5px rgba(45,52,54,0.09);
              --shadow-glow: 0 0 32px rgba(61,139,133,0.25);
          }
          "
        `);
    });
});
