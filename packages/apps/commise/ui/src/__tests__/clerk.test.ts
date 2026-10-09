/**
 * The Clerk appearance, in BOTH themes (`docs/design/uiOverhaul/ownerDecisions.md` D15; `buildSpec.md` §8).
 *
 * Clerk's hosted form is a THIRD-PARTY renderer, so no jsdom component test ever measures what it paints; this object
 * once shipped the primary button at 2.78:1 on exactly that blindness (#113, #114). Two parts now carry its colour:
 *
 * - `variables` take CONCRETE colours (Clerk derives shades from them), so they come from `themeFor(scheme)` and the
 *   appearance is built per scheme. Each pair is measured here, in light and in dark.
 * - `elements` are CLASS STRINGS of role utilities (`bg-paper`, `text-ink-muted`…), which the web theme swaps by
 *   custom property — so there is no per-scheme value to read off a string. The test reads each element's roles back
 *   out of its classes, looks the role up in the theme of each scheme, and measures THAT. A re-themed role or a class
 *   swapped for a worse one moves the measurement.
 *
 * This file REPLACES the earlier one, which measured hex values taken off an object of concrete colours: that shape is
 * gone (it could paint one theme only), so its assertions are re-derived here against the shape that exists.
 */
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { CLERK_CSS_LAYER, clerkAppearanceFor } from '../clerk.js';
import { themeFor, type ColorSchemeName } from '../theme/themeFor.js';
import type { Role } from '../tokens/colors.js';

const SCHEMES: readonly ColorSchemeName[] = ['light', 'dark'];

/** WCAG 2.2 AA, SC 1.4.3: body-size auth copy and button labels. */
const AA_TEXT = 4.5;

/** WCAG 2.2 AA, SC 1.4.11: a focus indicator or a control boundary. */
const AA_UI = 3;

/** `action-text` → `actionText`. */
const camel = (kebab: string): string => kebab.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The utility classes of one element, variants intact. */
const classesOf = (element: string | undefined): readonly string[] => (element ?? '').split(/\s+/).filter(Boolean);

/**
 * The role a class names for a property, or `undefined`: the LAST class wins, as it does for the cascade, and a
 * variant prefix (`hover:`, `focus:`, `min-[480px]:`) selects which state is read.
 */
function roleOfClass(classes: readonly string[], property: 'bg' | 'text' | 'border', variant = ''): Role | undefined {
    const prefix = `${variant}${property}-`;
    const names = classes
        .filter((name) => name.startsWith(prefix))
        .map((name) => camel(name.slice(prefix.length)).replace(/\/\d+$/, ''));

    return names.at(-1) as Role | undefined;
}

/** A role's value in a scheme. */
const colour = (scheme: ColorSchemeName, role: Role | undefined): string => {
    if (role === undefined) {
        throw new Error('an element states no role for a property the test measures');
    }

    return themeFor(scheme).colors[role];
};

describe.each(SCHEMES)('clerkAppearanceFor(%s) — variables', (scheme) => {
    const { variables } = clerkAppearanceFor(scheme);

    it('paints body text legibly on the form background', () => {
        expect(wcagContrast(variables.colorForeground, variables.colorBackground)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(wcagContrast(variables.colorMutedForeground, variables.colorBackground)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('paints the field text on the field background', () => {
        expect(wcagContrast(variables.colorInputForeground, variables.colorInput)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('paints the label of a primary-filled control on the primary', () => {
        expect(wcagContrast(variables.colorPrimaryForeground, variables.colorPrimary)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('names only variables Clerk 7 reads — the renamed-away names are ignored without a word', () => {
        for (const dead of [
            'colorText',
            'colorTextSecondary',
            'colorTextOnPrimaryBackground',
            'colorInputText',
            'colorInputBackground',
        ]) {
            expect(Object.keys(variables), dead).not.toContain(dead);
        }
    });

    it('paints a danger message legibly on the form background', () => {
        expect(wcagContrast(variables.colorDanger, variables.colorBackground)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('takes every colour from the scheme’s theme, not from a literal', () => {
        const { colors } = themeFor(scheme);

        expect(variables.colorBackground).toBe(colors.paper);
        expect(variables.colorForeground).toBe(colors.ink);
        expect(variables.colorPrimary).toBe(colors.action);
    });
});

it('builds two different appearances: the dark one is not the light one', () => {
    expect(clerkAppearanceFor('dark').variables.colorBackground).not.toBe(
        clerkAppearanceFor('light').variables.colorBackground,
    );
});

describe.each(SCHEMES)('clerkAppearanceFor(%s) — elements measured through their roles', (scheme) => {
    const { elements } = clerkAppearanceFor(scheme);
    const card = classesOf(elements.card);
    /** The surface text sits on: the card from 480 up, otherwise the canvas wash it is full-bleed on. */
    const surfaces: readonly Role[] = ['paper', 'canvas'];

    it.each([
        ['header title', 'headerTitle'],
        ['header subtitle', 'headerSubtitle'],
        ['divider text', 'dividerText'],
        ['field label', 'formFieldLabel'],
        ['field action', 'formFieldAction'],
        ['footer action text', 'footerActionText'],
        ['footer action link', 'footerActionLink'],
        ['alert text', 'alertText'],
        ['resend code link', 'formResendCodeLink'],
        ['identity edit button', 'identityPreviewEditButton'],
    ] as const)('reads the %s on both surfaces', (_what, key) => {
        const text = roleOfClass(classesOf(elements[key]), 'text');

        for (const surface of surfaces) {
            expect(
                wcagContrast(colour(scheme, text), colour(scheme, surface)),
                `${key} on ${surface}`,
            ).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it('reads the field text on the field fill', () => {
        const input = classesOf(elements.formFieldInput);

        expect(
            wcagContrast(colour(scheme, roleOfClass(input, 'text')), colour(scheme, roleOfClass(input, 'bg'))),
        ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('reads the primary label at rest and on hover, on its fill', () => {
        const primary = classesOf(elements.formButtonPrimary);
        const label = roleOfClass(primary, 'text');

        expect(wcagContrast(colour(scheme, label), colour(scheme, roleOfClass(primary, 'bg')))).toBeGreaterThanOrEqual(
            AA_TEXT,
        );
        expect(
            wcagContrast(colour(scheme, label), colour(scheme, roleOfClass(primary, 'bg', 'hover:'))),
        ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('draws the Google button label on its own fill', () => {
        const social = classesOf(elements.socialButtonsBlockButton);

        expect(
            wcagContrast(colour(scheme, roleOfClass(social, 'text')), colour(scheme, roleOfClass(social, 'bg'))),
        ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each([
        ['text field', 'formFieldInput'],
        ['one-time-code field', 'otpCodeFieldInput'],
    ] as const)('marks the focused %s distinguishably and at 3:1 against its surface', (_what, key) => {
        const field = classesOf(elements[key]);
        const focus = colour(scheme, roleOfClass(field, 'border', 'focus:'));
        const resting = colour(scheme, roleOfClass(field, 'border'));

        for (const surface of surfaces) {
            expect(wcagContrast(focus, colour(scheme, surface)), `${key} focus on ${surface}`).toBeGreaterThanOrEqual(
                AA_UI,
            );
        }

        expect(focus).not.toBe(resting);
    });

    it('gives a one-time-code cell no horizontal padding, so a digit is not clipped in a narrow box', () => {
        const cell = classesOf(elements.otpCodeFieldInput);

        expect(cell.filter((name) => /^(?:px|ps|pe|pl|pr)-/.test(name))).toEqual([]);
        expect(cell).toContain('text-center');
    });

    it('draws a field boundary at 3:1 against the surface (SC 1.4.11)', () => {
        const field = classesOf(elements.formFieldInput);

        for (const surface of surfaces) {
            expect(
                wcagContrast(colour(scheme, roleOfClass(field, 'border')), colour(scheme, surface)),
                `field edge on ${surface}`,
            ).toBeGreaterThanOrEqual(AA_UI);
        }
    });

    it('is a paper card from 480 up and the canvas below it', () => {
        expect(roleOfClass(card, 'bg', 'min-[480px]:')).toBe('paper');
        expect(card).not.toContain('bg-paper');
    });
});

describe('clerkAppearanceFor — layout and behaviour', () => {
    const appearance = clerkAppearanceFor('light');

    it('puts Google first, above the email form', () => {
        expect(appearance.layout.socialButtonsPlacement).toBe('top');
        expect(appearance.layout.socialButtonsVariant).toBe('blockButton');
    });

    it('names the CSS layer Clerk’s own styles go in (set on the provider, ranked below utilities in globals.css)', () => {
        expect(CLERK_CSS_LAYER).toBe('clerk');
    });

    it('is class strings only, so every colour is a role utility', () => {
        for (const [name, value] of Object.entries(appearance.elements)) {
            expect(typeof value, name).toBe('string');
        }
    });

    it('names no raw palette or Tailwind default colour', () => {
        const all = Object.values(appearance.elements).join(' ');

        expect(all).not.toMatch(
            /\b(?:bg|text|border|ring)-(?:white|black|sand|charcoal|slate|seafoam|coral|red|gray|zinc)\b/,
        );
    });

    it('never breaks the sign-up / sign-in link across lines, because it is the only way to register', () => {
        expect(classesOf(appearance.elements.footerActionLink)).toContain('whitespace-nowrap');
        expect(classesOf(appearance.elements.footerActionText)).toContain('whitespace-nowrap');
    });

    it('keeps fields 48 px tall with the 12 px radius', () => {
        expect(classesOf(appearance.elements.formFieldInput)).toEqual(expect.arrayContaining(['h-12', 'rounded-xl']));
    });

    it('goes full-bleed below 480 and a 440 px card from 480, then a bare 400 px column from 1024', () => {
        const card = classesOf(appearance.elements.card);

        expect(card).toEqual(expect.arrayContaining(['min-[480px]:p-8', 'lg:bg-transparent', 'lg:shadow-none']));
        expect(classesOf(appearance.elements.rootBox)).toEqual(
            expect.arrayContaining(['max-w-[27.5rem]', 'lg:max-w-[25rem]']),
        );
    });

    it('sets no inline padding in a style object that would out-rank the class (the 320 px defect, E23)', () => {
        expect(JSON.stringify(appearance.elements)).not.toContain('2.5rem');
    });
});
