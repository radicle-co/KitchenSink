import type { TypeRole } from '@commise/ui/tokens/typography';

/**
 * The focus line's type, in the one place both platforms read it: the `readingLarge` role (Inter regular, a reading role and
 * not a heading).
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

/**
 * The type role each line of a step is set in, the one map both platforms read: the focus line takes
 * {@link FOCUS_LINE_TYPE}'s role and every other line `readingBody`. The row passes the same role to its check box, so
 * the box and its slot are drawn for the text they label.
 */
export const LINE_TYPE_ROLE = {
    focus: FOCUS_LINE_TYPE.nativeTypeRole,
    other: 'readingBody',
} as const satisfies Readonly<Record<'focus' | 'other', TypeRole>>;
