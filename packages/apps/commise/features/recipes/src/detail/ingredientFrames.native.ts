/**
 * @module @commise/features-recipes — the native ingredients card's frames (ADR-0080): the paper card, its heading row,
 * the owner's Edit row, a group's label and the hairline between rows (`RecipeDetailAndroid384`). Feature-local: the
 * section and its row are the only consumers.
 *
 * Every value is a token or a theme key, so a frame follows the scheme with no hook.
 */
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

/** The drawn check box's side, in points: `CheckBoxGlyph` fixes it at 18. */
const CHECK_BOX_SIDE = 18;

/**
 * Where a row's text starts: its gutter, the check box, and the gap after it. The hairline between rows starts here
 * (`IngredientCheckRow.native.tsx` pads and gaps with the same two steps).
 */
export const ROW_TEXT_INSET = nativeTokens.spacing[4] + CHECK_BOX_SIDE + nativeTokens.spacing[3];

/** The hairline between two rows, inset past the check box so it starts under the text. */
export const IngredientRowDivider = styled(YStack, {
    name: 'IngredientRowDivider',
    marginLeft: ROW_TEXT_INSET,
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

/**
 * The slot the check box sits in: as tall as the `body` role's first line, with the box centred in it, so the box
 * follows the line when the role changes. It replaces a fixed 1 pt `marginTop`, which centred on the old 20 pt line.
 */
export const IngredientCheckBoxSlot = styled(XStack, {
    name: 'IngredientCheckBoxSlot',
    height: nativeTokens.type.body.lineHeight,
    alignItems: 'center',
});
