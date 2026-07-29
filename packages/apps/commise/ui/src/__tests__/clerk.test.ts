/**
 * Contrast contract for the Clerk appearance object (#113).
 *
 * `clerkAppearance` is the ONLY surface in the product whose colours are consumed by a third-party renderer, so
 * no jsdom component test in this repo ever measures it — and it had no test at all. That is how it came to
 * ship the auth form's PRIMARY button with a white label on `seafoam-light` (2.78:1) whose hover state moved to
 * `seafoam` (4.02:1): both states below the 4.5:1 body floor, on the first screen every user sees, in the one
 * place the repo's rendered-contrast helpers could not reach.
 *
 * The same object also spent `semantic.primary` on link/action TEXT (`formFieldAction`, `footerActionLink`,
 * `formResendCodeLink`, `identityPreviewEditButton`) at 2.78:1 and `semantic.secondary` (coral) on the
 * secondary button's label at 2.40:1 — the accent-as-text failure the palette JSDoc names, reproduced inside
 * the auth form.
 *
 * Every assertion here measures a colour PAIR taken out of the shipped object, so the test moves with a
 * re-theme instead of pinning hexes; `culori` supplies the luminance math (`@commise/test-utils` cannot be
 * imported from `@commise/ui` without closing a workspace cycle).
 */
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { clerkAppearance } from '../clerk.js';
import { palette } from '../tokens/colors.js';

/** WCAG 2.1 AA, SC 1.4.3 — every string measured here is body-size auth copy or a button label. */
const AA_NORMAL_TEXT = 4.5;

const { variables, elements } = clerkAppearance;

/**
 * A text colour taken off one appearance element, with the opaque surface Clerk paints it on.
 *
 * `card` is the form's own background; the buttons state their own `backgroundColor`, and where one does the
 * pairing is read from the object rather than assumed, so repointing a fill cannot leave the label behind.
 */
const TEXT_ON_SURFACE: readonly { readonly what: string; readonly color: string; readonly surface: string }[] = [
    { what: 'header title', color: elements.headerTitle.color, surface: elements.card.backgroundColor },
    { what: 'header subtitle', color: elements.headerSubtitle.color, surface: elements.card.backgroundColor },
    { what: 'divider text', color: elements.dividerText.color, surface: elements.card.backgroundColor },
    { what: 'field label', color: elements.formFieldLabel.color, surface: elements.card.backgroundColor },
    {
        what: 'field input text',
        color: elements.formFieldInput.color,
        surface: elements.formFieldInput.backgroundColor,
    },
    { what: 'field action', color: elements.formFieldAction.color, surface: elements.card.backgroundColor },
    {
        what: 'field action (hover)',
        color: elements.formFieldAction__hover.color,
        surface: elements.card.backgroundColor,
    },
    {
        what: 'secondary button label',
        color: elements.formButtonSecondary.color,
        surface: elements.card.backgroundColor,
    },
    {
        what: 'social button label',
        color: elements.socialButtonsBlockButton.color,
        surface: elements.socialButtonsBlockButton.backgroundColor,
    },
    { what: 'footer action link', color: elements.footerActionLink.color, surface: elements.card.backgroundColor },
    {
        what: 'footer action link (hover)',
        color: elements.footerActionLink__hover.color,
        surface: elements.card.backgroundColor,
    },
    { what: 'footer action text', color: elements.footerActionText.color, surface: elements.card.backgroundColor },
    { what: 'alert text', color: elements.alertText.color, surface: elements.card.backgroundColor },
    {
        what: 'identity preview edit button',
        color: elements.identityPreviewEditButton.color,
        surface: elements.card.backgroundColor,
    },
    { what: 'resend code link', color: elements.formResendCodeLink.color, surface: elements.card.backgroundColor },
    {
        what: 'user menu action text',
        // The popover states only radius + shadow, so its fill is Clerk's `colorBackground` variable.
        color: elements.userButtonPopoverActionButtonText.color,
        surface: variables.colorBackground,
    },
];

describe('clerkAppearance contrast (WCAG 2.1 AA, SC 1.4.3)', () => {
    it('paints the primary button label legibly at REST', () => {
        expect(
            wcagContrast(variables.colorTextOnPrimaryBackground, elements.formButtonPrimary.backgroundColor),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('paints the primary button label legibly on HOVER — a hover state is a state like any other', () => {
        expect(
            wcagContrast(variables.colorTextOnPrimaryBackground, elements.formButtonPrimary__hover.backgroundColor),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it.each(TEXT_ON_SURFACE)('reads the $what against the surface behind it', ({ color, surface }) => {
        expect(wcagContrast(color, surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('keeps the primary button in the teal CTA family the design-system Button paints', () => {
        // Convergence, not decoration: the web `Button` primary tier is a `seafoam → ocean-dark` gradient, so
        // the auth form's primary control resolving to some OTHER teal would be a second primary button.
        expect([palette.seafoam, palette['ocean-dark']]).toContain(elements.formButtonPrimary.backgroundColor);
        expect([palette.seafoam, palette['ocean-dark']]).toContain(elements.formButtonPrimary__hover.backgroundColor);
    });
});
