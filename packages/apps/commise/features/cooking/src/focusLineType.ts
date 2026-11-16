import type { TypeRole } from '@commise/ui/tokens/typography';

/**
 * The type of each line of a step, in the one place both platforms read it: the focus line is the `readingLarge` role
 * (Inter regular, a reading role and not a heading) and every other line is `readingBody`.
 *
 * `nativeTypeRole` names the native type role; `webClassName` is its web counterpart, written as a complete class literal
 * because Tailwind builds only class text it can find in a scanned file. The web size class is `text-` plus the kebab-case
 * of the native role, and a test pins that pairing for every entry so the two cannot drift. A row passes the native role
 * to its check box too, so the box and its slot are drawn for the text they label. `satisfies` keeps a misspelt role from
 * compiling.
 */
export const LINE_TYPE = {
    focus: { nativeTypeRole: 'readingLarge', webClassName: 'text-reading-large' },
    other: { nativeTypeRole: 'readingBody', webClassName: 'text-reading-body' },
} as const satisfies Readonly<
    Record<'focus' | 'other', { readonly nativeTypeRole: TypeRole; readonly webClassName: string }>
>;

/** The focus line's type, for the screens that set only that line. */
export const FOCUS_LINE_TYPE = LINE_TYPE.focus;
