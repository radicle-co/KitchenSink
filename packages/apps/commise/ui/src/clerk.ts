import { palette, semantic, tint } from './tokens/colors.js';
import { radius } from './tokens/radius.js';
import { shadows } from './tokens/shadows.js';
import { fonts, fontSizes, fontWeights } from './tokens/typography.js';

/**
 * @module @commise/ui/clerk — the appearance object Clerk's hosted components render the auth surface with.
 *
 * ## Contrast here is invisible to every other test in the repo (#113)
 *
 * These values are consumed by a THIRD-PARTY renderer, so no jsdom component test ever measures what they
 * paint — and this object had no test at all. It therefore shipped the auth form's primary button with a white
 * label on `seafoam-light` (2.78:1) hovering to `seafoam` (4.02:1): both states under the 4.5:1 body floor, on
 * the first screen every user sees. Its link/action TEXT spent the same light teal at 2.78:1, and the secondary
 * button's label spent `coral` at 2.40:1 — the accent-as-text failure `colors.ts` documents, reproduced inside
 * the auth form.
 *
 * The corrected pairings follow the palette's ONE rule rather than restating it: a filled teal CTA carries
 * `white`, and a teal that is TEXT is `ocean-dark`. `__tests__/clerk.test.ts` measures every pair in here, so a
 * future re-theme cannot quietly reintroduce an illegible state.
 *
 * `variables.colorPrimary` deliberately stays `seafoam-light`: Clerk derives non-text accents (the input focus
 * ring, spinners) from it, and that is the role the light teal is correct in. Every element where the colour
 * lands under TEXT states its own value below.
 */
export const clerkAppearance = {
    variables: {
        colorPrimary: palette['seafoam-light'],
        colorBackground: palette.white,
        colorText: palette.charcoal,
        colorTextSecondary: palette.slate,
        colorTextOnPrimaryBackground: palette.white,
        colorDanger: palette['error-dark'],
        colorSuccess: palette.success,
        colorInputBackground: palette.white,
        colorInputText: palette.charcoal,
        fontFamily: fonts.body,
        fontFamilyButtons: fonts.body,
        borderRadius: radius.md,
        fontSize: fontSizes['body-md'],
        fontWeight: {
            normal: Number(fontWeights.normal),
            medium: Number(fontWeights.medium),
            bold: Number(fontWeights.semibold),
        },
    },
    layout: {
        socialButtonsPlacement: 'bottom' as const,
        socialButtonsVariant: 'blockButton' as const,
    },
    elements: {
        card: {
            backgroundColor: semantic.card,
            border: 'none',
            borderRadius: radius.lg,
            boxShadow: shadows.sm,
            padding: '2.5rem',
        },
        cardBox: {
            borderRadius: radius.lg,
        },
        headerTitle: {
            fontFamily: fonts.display,
            fontSize: fontSizes['display-md'],
            fontWeight: fontWeights.bold,
            color: semantic.foreground,
        },
        headerSubtitle: {
            fontSize: fontSizes['body-sm'],
            color: semantic.foreground,
        },
        dividerLine: {
            borderColor: palette.mist,
            borderWidth: '1px',
        },
        dividerText: {
            color: palette.slate,
            fontSize: fontSizes.caption,
        },
        formFieldLabel: {
            color: semantic.foreground,
            fontSize: fontSizes['body-sm'],
            fontWeight: fontWeights.medium,
        },
        formFieldInput: {
            backgroundColor: semantic.card,
            borderColor: palette.mist,
            borderStyle: 'solid',
            borderWidth: '1px',
            borderRadius: radius.md,
            fontSize: fontSizes['body-md'],
            color: semantic.foreground,
            padding: '0.75rem 1rem',
        },
        formFieldInput__focus: {
            borderColor: semantic.primary,
        },
        // "Forgot password?" and friends are LINKS a reader reads, so the teal is `ocean-dark`, not the light
        // accent (2.78:1). Hover deepens to the charcoal foreground rather than to `seafoam` (which was 4.02:1).
        formFieldAction: {
            color: palette['ocean-dark'],
            fontSize: fontSizes['body-sm'],
            fontWeight: fontWeights.medium,
        },
        formFieldAction__hover: {
            color: semantic.foreground,
        },
        // The FILLED CTA — `seafoam` → `ocean-dark`, the same ramp the design-system `Button` primary tier
        // paints as `from-seafoam to-ocean-dark`. Under `colorTextOnPrimaryBackground` (white) that is 4.67:1
        // resting and 6.20:1 hovered. It used to be `semantic.primary` (2.78:1) hovering to `seafoam` (4.02:1).
        formButtonPrimary: {
            backgroundColor: palette.seafoam,
            borderRadius: radius.full,
            fontSize: fontSizes['body-md'],
            fontWeight: fontWeights.semibold,
            textTransform: 'none' as const,
            padding: '0.75rem 1.5rem',
        },
        formButtonPrimary__hover: {
            backgroundColor: palette['ocean-dark'],
        },
        // Coral survives on the BORDER (an accent, 3:1 territory) and is demoted on the LABEL, which was
        // 2.40:1 — the identical split `buttonSurfaceClass`'s `secondary` tier already makes on web.
        formButtonSecondary: {
            borderColor: semantic.secondary,
            borderWidth: '1px',
            borderRadius: radius.full,
            color: palette.slate,
            fontSize: fontSizes['body-md'],
            fontWeight: fontWeights.medium,
            textTransform: 'none' as const,
        },
        formButtonSecondary__hover: {
            backgroundColor: tint(palette.coral, 0.08),
        },
        socialButtonsBlockButton: {
            borderRadius: radius.full,
            borderColor: palette.mist,
            borderWidth: '1px',
            fontSize: fontSizes['body-sm'],
            fontWeight: fontWeights.medium,
            textTransform: 'none' as const,
            backgroundColor: semantic.card,
            color: semantic.foreground,
        },
        socialButtonsBlockButton__hover: {
            backgroundColor: semantic.muted,
        },
        socialButtonsIconButton: {
            borderRadius: radius.full,
            borderColor: palette.mist,
        },
        // The "Sign up" / "Sign in" cross-link — the ONLY route to registration (see the no-landing-screen
        // decision), so it is load-bearing text and takes the text-grade teal.
        footerActionLink: {
            color: palette['ocean-dark'],
            fontSize: fontSizes['body-sm'],
            fontWeight: fontWeights.medium,
        },
        footerActionLink__hover: {
            color: semantic.foreground,
            textDecoration: 'underline',
        },
        footerActionText: {
            color: palette.slate,
            fontSize: fontSizes['body-sm'],
        },
        alertText: {
            color: semantic.destructive,
            fontSize: fontSizes['body-sm'],
        },
        alert: {
            borderRadius: radius.md,
        },
        otpCodeFieldInput: {
            borderRadius: radius.md,
            borderColor: palette.mist,
        },
        otpCodeFieldInput__focus: {
            borderColor: semantic.primary,
        },
        identityPreviewEditButton: {
            color: palette['ocean-dark'],
        },
        formResendCodeLink: {
            color: palette['ocean-dark'],
        },
        userButtonPopoverCard: {
            borderRadius: radius.lg,
            boxShadow: shadows.md,
        },
        userButtonPopoverActionButton__hover: {
            backgroundColor: tint(palette['seafoam-light'], 0.08),
        },
        userButtonPopoverActionButtonText: {
            color: semantic.foreground,
        },
        userButtonPopoverFooter: {
            borderTop: `1px solid ${semantic.border}`,
        },
    },
};
