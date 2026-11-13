import type { TypeRole } from '@commise/ui/tokens/typography';

/**
 * The focus line's type, in the one place both platforms read it: the `readingLarge` role (Inter regular 28/32, a reading
 * role and not a heading).
 *
 * `nativeTypeRole` names the native type role; `webClassName` is its web counterpart, written as a complete class literal
 * because Tailwind builds only class text it can find in a scanned file. The web size class is `text-` plus the kebab-case
 * of the native role, and a test pins that pairing so the two cannot drift. `satisfies` keeps a misspelt role from
 * compiling.
 */
export const FOCUS_LINE_TYPE = {
    nativeTypeRole: 'readingLarge',
    webClassName: 'text-reading-large',
} as const satisfies { readonly nativeTypeRole: TypeRole; readonly webClassName: string };
