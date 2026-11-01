/**
 * @module @commise/features-recipes — the native recipe page's shared layout frames (ADR-0080): the facts more than one
 * section leaf draws, written once as Tamagui frames. The native twin of `detailLayoutClasses.ts`, which holds the same
 * facts as Tailwind classes for web. Feature-local: it is not a package export, and a fact with one consumer stays on
 * that consumer's own stack instead.
 *
 * Every value is a token or a theme key, so a frame follows the scheme with no hook.
 */
import { Text } from '@commise/ui/text';
import { styled, XStack, YStack } from 'tamagui';

/**
 * One section of the page: its heading row, then its blocks, space-3 apart. From a 720 pt body the ingredients
 * section takes five parts of twelve of the row (build spec §6.1, the web's `col-span-5`).
 *
 * @pattern Variant — the column a section fills is a closed Tamagui variant, not a style passed in
 */
export const DetailSection = styled(YStack, {
    name: 'DetailSection',
    gap: '$3',

    variants: {
        column: {
            ingredients: { flex: 5 },
        },
    } as const,
});

/**
 * Blocks stacked with a section's gap and no gutter of their own: the gutter belongs to whatever holds them. From a
 * 720 pt body the steps column is one, and takes seven parts of twelve of the row (§6.1, the web's `col-span-7`).
 *
 * @pattern Variant — the column a stack fills is a closed Tamagui variant, not a style passed in
 */
export const DetailStack = styled(YStack, {
    name: 'DetailStack',
    gap: '$8',

    variants: {
        column: {
            steps: { flex: 7 },
        },
    } as const,
});

/** A section's heading row: the heading, then its controls, wrapping onto the next line before they squeeze. */
export const DetailHeadingRow = styled(XStack, {
    name: 'DetailHeadingRow',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '$2',
});

/** A section's heading: the `sectionTitle` role in `ink`, announced as a heading. */
export const DetailSectionHeading = styled(Text, {
    name: 'DetailSectionHeading',
    typeRole: 'sectionTitle',
    color: '$ink',
    role: 'heading',
});
