import { palette, semantic } from './tokens/colors.js';
import { radius } from './tokens/radius.js';
import { shadows } from './tokens/shadows.js';
import { fonts, fontSizes, fontWeights } from './tokens/typography.js';

export const clerkAppearance = {
    variables: {
        colorPrimary: palette['seafoam-light'],
        colorBackground: palette.white,
        colorText: palette.charcoal,
        colorTextSecondary: palette.slate,
        colorTextOnPrimaryBackground: palette.white,
        colorDanger: palette.error,
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
        formFieldAction: {
            color: semantic.primary,
            fontSize: fontSizes['body-sm'],
            fontWeight: fontWeights.medium,
        },
        formFieldAction__hover: {
            color: palette.seafoam,
        },
        formButtonPrimary: {
            backgroundColor: semantic.primary,
            borderRadius: radius.full,
            fontSize: fontSizes['body-md'],
            fontWeight: fontWeights.semibold,
            textTransform: 'none' as const,
            padding: '0.75rem 1.5rem',
        },
        formButtonPrimary__hover: {
            backgroundColor: palette.seafoam,
        },
        formButtonSecondary: {
            borderColor: semantic.secondary,
            borderWidth: '1px',
            borderRadius: radius.full,
            color: semantic.secondary,
            fontSize: fontSizes['body-md'],
            fontWeight: fontWeights.medium,
            textTransform: 'none' as const,
        },
        formButtonSecondary__hover: {
            backgroundColor: 'rgba(232,145,122,0.08)',
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
        footerActionLink: {
            color: semantic.primary,
            fontSize: fontSizes['body-sm'],
            fontWeight: fontWeights.medium,
        },
        footerActionLink__hover: {
            color: palette.seafoam,
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
            color: semantic.primary,
        },
        formResendCodeLink: {
            color: semantic.primary,
        },
        userButtonPopoverCard: {
            borderRadius: radius.lg,
            boxShadow: shadows.md,
        },
        userButtonPopoverActionButton__hover: {
            backgroundColor: 'rgba(91,168,160,0.08)',
        },
        userButtonPopoverActionButtonText: {
            color: semantic.foreground,
        },
        userButtonPopoverFooter: {
            borderTop: `1px solid ${semantic.border}`,
        },
    },
};
