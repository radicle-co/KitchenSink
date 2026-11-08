/**
 * @module @commise/features-recipes — the few boxes the Recipes list is laid out with (native).
 *
 * The list is full width so its header can scroll with it, which makes the 16 pt side gutter the list's own job: the
 * header insets itself, and each row, the empty body, the footer and the chips/result bar carry it through {@link ListEdge}.
 * Styled with Tamagui tokens, so the screen files that hold the React Native styling ratchet add nothing to it. The pinned search
 * field's own parts are `@commise/ui/pinned-search`'s.
 *
 * @pattern Variant — a Tamagui `styled` frame with a closed `compact` variant
 */
import { styled, View } from 'tamagui';

import { nativeTokens } from '@commise/ui/native';

/** Presentational: a box with the 16 pt side gutter every list child outside the header carries. */
export const ListEdge = styled(View, { name: 'RecipeListEdge', paddingHorizontal: '$4' });

/**
 * Presentational: the header group's box: 8 above, and 16 below before the chips, or 8 in compact height (what the screen's
 * top padding and gap gave it before the header became the list's first child).
 */
export const ListHeaderBox = styled(View, {
    name: 'RecipeListHeaderBox',
    paddingTop: '$2',
    paddingBottom: '$4',
    variants: { compact: { true: { paddingBottom: '$2' } } } as const,
});

/**
 * Presentational: the header's group: title (or the compact heading) and the search field's spacer, in one box. In compact height, a phone
 * held sideways, the heading shares one wrapping row with the field and the box insets its own sides.
 */
export const ListHeaderGroup = styled(View, {
    name: 'RecipeListHeaderGroup',
    gap: '$4',
    variants: {
        compact: {
            true: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '$3', paddingHorizontal: '$4' },
        },
    } as const,
});

/** Presentational: a box that fills the room it is given: the Recipes frame and the content it holds. */
export const FillBox = styled(View, { name: 'RecipeListFill', flex: 1 });

/** What {@link ListHeaderBox} pads above its group (its `$2`), so the search spacer's y becomes a list-content offset. */
export const HEADER_TOP_PX = nativeTokens.spacing[2];
