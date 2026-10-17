/**
 * @module tokens/brands — third-party brand colours, fixed by the brand's owner and DELIBERATELY the same in both themes.
 *
 * Every other colour a component paints is a role from `useTheme()`, because a role re-themes. A brand control is the
 * one exception the colour rule admits: its owner specifies its look, and recolouring it — to a role, or per scheme — is
 * what the owner forbids. So these values are tokens (one authority, held here with the rest of the colour data) and
 * not roles, and only a brand control reads them.
 *
 * - `googleSignIn`: Google's sign-in button, LIGHT theme (Sign in with Google branding guidelines), used in both
 *   schemes so it never outweighs the system Sign in with Apple button beside it (plan 012 D9, staff-ux-engineer
 *   SPECIFY 2026-10-15), and the four colours of the official "G", which is never redrawn or recoloured.
 *
 * Sign in with Apple has no entry: it is the system's own button, which carries Apple's colours itself.
 */

/** Google's light-theme sign-in button and the colours of its "G". */
export const googleSignIn = {
    fill: '#FFFFFF',
    edge: '#747775',
    text: '#1F1F1F',
    mark: { red: '#EA4335', blue: '#4285F4', yellow: '#FBBC05', green: '#34A853' },
} as const;
