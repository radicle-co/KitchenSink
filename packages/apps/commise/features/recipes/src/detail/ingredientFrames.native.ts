/**
 * @module @commise/features-recipes — the native ingredients card's frames (ADR-0080): the paper card, its heading row,
 * the owner's Edit row, a group's label and the hairline between rows (`RecipeDetailAndroid384`). Feature-local: the
 * section and its row are the only consumers.
 *
 * Every value is a token or a theme key, so a frame follows the scheme with no hook.
 */
import { checkBoxSideAt } from '@commise/ui/check-box-glyph';
import { nativeTokens } from '@commise/ui/native';
import { Text } from '@commise/ui/text';
import { styled, XStack, YStack } from 'tamagui';

import { DetailCard } from './detailFrames.native.js';

/**
 * The card: paper, the large radius and a hairline edge, with 4 of air above the first block and below the last. The board
 * also gives it the medium shadow; no Tamagui frame carries a shadow yet (the style guards reject a spread elevation), so
 * the hairline defines the edge until the design system has a shadow primitive.
 */
export const IngredientsCard = styled(DetailCard, {
    name: 'IngredientsCard',
    paddingVertical: '$1',
});

/** The heading row: the heading, "for {n}", then the stepper at the end, wrapping before it squeezes. */
export const IngredientsHeadRow = styled(XStack, {
    name: 'IngredientsHeadRow',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '$2',
    paddingTop: '$3',
    paddingBottom: '$1',
    paddingLeft: '$4',
    paddingRight: '$3',
});

/** The row under the heading that holds the owner's Edit. */
export const IngredientsEditRow = styled(XStack, {
    name: 'IngredientsEditRow',
    alignItems: 'center',
    paddingHorizontal: '$4',
    paddingBottom: '$1',
});

/** A group's label: the `caption` role in `inkMuted`, announced as a heading. */
export const IngredientGroupLabel = styled(Text, {
    name: 'IngredientGroupLabel',
    typeRole: 'caption',
    color: '$inkMuted',
    role: 'heading',
    paddingTop: '$4',
    paddingBottom: '$1',
    paddingHorizontal: '$4',
});

/**
 * Where a row's text starts under the system text scale: its gutter, the check box beside `body` text (which grows with
 * that text), and the gap after it. The hairline between rows starts here (`IngredientCheckRow.native.tsx` pads and
 * gaps with the same two steps). Pure.
 *
 * @param textScale - The system text scale (`fontScale`), the one the design system grows the box from.
 * @returns The inset in points.
 */
export const rowTextInsetAt = (textScale: number): number =>
    nativeTokens.spacing[4] + checkBoxSideAt('body', textScale) + nativeTokens.spacing[3];

/** The hairline between two rows. The row insets it past the check box (`rowTextInsetAt`) so it starts under the text. */
export const IngredientRowDivider = styled(YStack, {
    name: 'IngredientRowDivider',
    borderTopWidth: '$hairline',
    borderColor: '$lineDivider',
});

/** The notices under the heading (scaled-from, unreachable lines, withdrawn foods), inset to the card's gutter. */
export const IngredientsNotices = styled(YStack, {
    name: 'IngredientsNotices',
    gap: '$2',
    paddingHorizontal: '$4',
});

/** The withdrawn-food tile: a warning tint under an `ink` label in the `meta` role. */
export const RemovedFoodNotice = styled(Text, {
    name: 'RemovedFoodNotice',
    typeRole: 'meta',
    color: '$ink',
    backgroundColor: '$attentionTint',
    borderRadius: '$md',
    paddingHorizontal: '$3',
    paddingVertical: '$2',
});

/** The list's first row: "Servings" and the stepper at the end (board `.sheetServe`). */
export const PinnedServingsRow = styled(XStack, {
    name: 'PinnedServingsRow',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: '$3',
    paddingBottom: '$1',
    paddingLeft: '$4',
    paddingRight: '$3',
});
