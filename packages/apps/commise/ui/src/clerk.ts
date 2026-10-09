import { themeFor, type ColorSchemeName } from './theme/themeFor.js';
import { radius } from './tokens/radius.js';
import { fonts, fontSizes, fontWeights } from './tokens/typography.js';

/**
 * @module @commise/ui/clerk — the appearance object Clerk's hosted components render the auth surface with, in BOTH
 * themes (`docs/design/uiOverhaul/ownerDecisions.md` D15; `docs/design/uiOverhaul/buildSpec.md` §8).
 *
 * ## Two kinds of colour, two mechanisms
 *
 * Clerk derives its incidental shades (hover washes, spinners, disabled fills) from `variables`, which must be
 * CONCRETE colours — it cannot be handed a CSS custom property. So `variables` come from `themeFor(scheme).colors` and
 * the appearance is built PER SCHEME: the web page picks the scheme from the system setting
 * (`useColorScheme`) and Clerk re-mounts its styles. Every named colour of the form, though — the card, the fields,
 * the buttons, the links — is a CLASS STRING of role utilities (`bg-paper`, `text-ink-muted`…), which swap with the
 * theme by custom property and so need no scheme at all.
 *
 * ## Why the classes beat Clerk's own styles
 *
 * Clerk's styles are unlayered emotion CSS, which out-ranks anything in a Tailwind `@layer` regardless of specificity.
 * `cssLayerName` moves them into a named layer — set on `<ClerkProvider appearance>` (`appDocument`), which is where Clerk
 * reads this global option — and `globals.css` declares that layer BELOW `utilities` (`@layer theme,
 * base, clerk, components, utilities`), so a utility on an element wins. Without the declaration the classes below
 * would silently lose; `tests/e2e/authPages.spec.ts` reads computed colours in a real browser to prove they do not.
 *
 * ## Contrast here is invisible to every other test (#113, #114)
 *
 * Clerk is a third-party renderer, so no component test measures what it paints; the object once shipped the primary
 * button at 2.78:1 and a focus border at 2.78:1 for that reason. `__tests__/clerk.test.ts` measures every pair in both
 * schemes, reading each element's roles back out of its classes.
 *
 * ## The layout (buildSpec §8, E23)
 *
 * Below 480 px there is no card: the form sits on the canvas inside the page's 24 px side padding (a 272 px column at
 * 320). From 480 it is a 440 px `paper` card; from 1024 the page is a split and the form a bare 400 px column. All of
 * that is class strings: a style OBJECT's `padding` out-ranks a class, which is how the card kept its 40 px padding at
 * 320 px.
 */

/**
 * The variables Clerk 7 reads (`@clerk/ui`'s `Variables`), by the names it now uses. ⚠️ Clerk renamed them from the
 * `colorText` / `colorInputText` / `colorTextOnPrimaryBackground` family it used to read, and an old name is IGNORED
 * without a word: the object below sat on three dead names until a real browser showed Clerk's own near-black in the
 * field. A literal checked against this list cannot misspell one; whether Clerk still reads each is what
 * `tests/e2e/authPages.spec.ts` proves, by computed colour.
 */
interface ClerkVariables {
    readonly colorPrimary: string;
    readonly colorPrimaryForeground: string;
    readonly colorForeground: string;
    readonly colorMutedForeground: string;
    readonly colorMuted: string;
    readonly colorBackground: string;
    readonly colorInput: string;
    readonly colorInputForeground: string;
    readonly colorBorder: string;
    readonly colorRing: string;
    readonly colorNeutral: string;
    readonly colorDanger: string;
    readonly colorSuccess: string;
    readonly colorModalBackdrop: string;
    readonly fontFamily: string;
    readonly fontFamilyButtons: string;
    readonly borderRadius: string;
    readonly fontSize: string;
    readonly fontWeight: { readonly normal: number; readonly medium: number; readonly bold: number };
}

/** The CSS layer Clerk's own styles are placed in; `globals.css` orders it below `utilities`. */
export const CLERK_CSS_LAYER = 'clerk';

/** A text field: 48 px, a 12 px radius, a `lineControl` edge and a `focusRing` border that is the focus indicator. */
const FIELD =
    'h-12 rounded-xl border border-line-control bg-paper px-4 text-body text-ink shadow-none outline-none ' +
    'focus:border-focus-ring focus:ring-2 focus:ring-focus-ring';

/**
 * A one-time-code cell: the field's edge, fill and focus, with NO horizontal padding and the digit centred. The cell is
 * a narrow box (a 272 px column holds the whole row), and the field's 16 px of padding on each side would leave a digit
 * 8 px to sit in.
 */
const OTP_FIELD =
    'h-12 rounded-xl border border-line-control bg-paper text-center text-body text-ink shadow-none outline-none ' +
    'focus:border-focus-ring focus:ring-2 focus:ring-focus-ring';

/**
 * Clerk's appearance for one colour scheme.
 *
 * @param scheme - The scheme the page is in.
 * @returns The appearance, for `<SignIn appearance>` and `<SignUp appearance>`. Pure.
 */
export function clerkAppearanceFor(scheme: ColorSchemeName) {
    const { colors } = themeFor(scheme);

    return {
        variables: {
            colorPrimary: colors.action,
            colorPrimaryForeground: colors.onAction,
            colorForeground: colors.ink,
            colorMutedForeground: colors.inkMuted,
            colorMuted: colors.surfaceMuted,
            colorBackground: colors.paper,
            colorInput: colors.paper,
            colorInputForeground: colors.ink,
            colorBorder: colors.lineDivider,
            colorRing: colors.focusRing,
            colorNeutral: colors.ink,
            colorDanger: colors.dangerText,
            colorSuccess: colors.actionText,
            colorModalBackdrop: colors.scrim,
            fontFamily: fonts.body,
            fontFamilyButtons: fonts.body,
            borderRadius: radius.md,
            fontSize: fontSizes['body-md'],
            fontWeight: {
                normal: Number(fontWeights.normal),
                medium: Number(fontWeights.medium),
                bold: Number(fontWeights.semibold),
            },
        } satisfies ClerkVariables,
        layout: {
            // Google is the first thing offered, above the email form (§8).
            socialButtonsPlacement: 'top' as const,
            socialButtonsVariant: 'blockButton' as const,
        },
        elements: {
            // A size container, so the title's `text-large-title` clamps against THIS column (28 px) and not the window.
            rootBox: '@container w-full max-w-[27.5rem] lg:max-w-[25rem]',
            cardBox: 'w-full shadow-none',
            card:
                'w-full gap-6 border-0 bg-transparent p-0 shadow-none ' +
                'min-[480px]:rounded-xl min-[480px]:bg-paper min-[480px]:p-8 min-[480px]:shadow-sm ' +
                'lg:bg-transparent lg:p-0 lg:shadow-none',
            headerTitle: 'font-display text-large-title text-ink',
            // The brand line, "Your recipes, in one place." (`localization.signIn.start.subtitle`).
            headerSubtitle: 'text-body text-ink-muted',
            dividerLine: 'bg-line-divider',
            dividerText: 'text-meta text-ink-muted',
            formFieldLabel: 'text-label text-ink',
            formFieldInput: FIELD,
            // An OTP field is one 6-digit input (SC 3.3.8 favours letting the OS fill it); its focused edge is the cue.
            otpCodeFieldInput: OTP_FIELD,
            formFieldAction: 'text-meta font-medium text-action-text hover:text-ink',
            // The filled primary: 52 px, the `action` fill with a white label, `actionPressed` on hover.
            formButtonPrimary:
                'h-[3.25rem] w-full rounded-full bg-action text-label normal-case text-on-action shadow-sm ' +
                'hover:bg-action-pressed',
            formButtonReset: 'rounded-full border border-line-control bg-paper text-label normal-case text-ink',
            socialButtonsBlockButton:
                'h-12 rounded-full border border-line-control bg-paper text-label normal-case text-ink shadow-none ' +
                'hover:bg-ink/6',
            // The cross-link is the ONLY way to register (FR-045a), so its text never breaks across lines.
            footerActionText: 'whitespace-nowrap text-meta text-ink-muted',
            footerActionLink: 'whitespace-nowrap text-meta font-medium text-action-text hover:underline',
            alert: 'rounded-xl border border-danger/40 bg-danger/10',
            alertText: 'text-meta text-danger-text',
            identityPreviewEditButton: 'text-action-text',
            formResendCodeLink: 'text-action-text',
        },
    };
}
