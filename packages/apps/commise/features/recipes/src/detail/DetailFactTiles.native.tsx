/**
 * @module @commise/features-recipes — the native recipe page's fact tiles: Total, Prep and Difficulty, each a `cover-steel`
 * tile with its glyph and label and its value (`RecipeDetailAndroid384`, `designAnswers.md` D5). A missing time hides its
 * tile; with no tile to show nothing is drawn. A tile is one group, so a screen reader says "Total: 1 h 50 min".
 *
 * Three go across only while each tile has 100 pt per unit of text scale (`columnsKeepingMinOf`, designer iosBatch2); below that
 * each takes a row, the label at the start and the value at the end, so no word is ever broken. Difficulty is plain text in
 * the same value style as the others, as on the board and the cards.
 *
 * Presentational: props to JSX.
 */
import { Icon } from '@commise/ui/icon';
import type { IconName } from '@commise/ui/icon';
import { spacing } from '@commise/ui/scale';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { styled, XStack, YStack } from 'tamagui';

import { columnsKeepingMinOf, type ColumnMinimum } from '../card/cardGridLayout.js';
import type { DetailStatCell } from './detailFacts.js';
import type { DetailNativeLayout } from './model.js';

/** The room a tile needs per unit of text scale to hold a label and a value on two lines without breaking a word. */
const TILE_MIN_PER_SCALE = 100;

/** All the tiles across, each keeping its minimum, with space-2 between them. */
const TILES_ACROSS = (count: number): ColumnMinimum => ({
    columns: count,
    minPerColumn: TILE_MIN_PER_SCALE,
    gap: spacing[2],
});

const GLYPH: Readonly<Record<DetailStatCell['id'], IconName>> = {
    total: 'clock',
    prep: 'timer',
    difficulty: 'chartColumn',
};

/**
 * The tiles' container: a row of tiles across, or a column of tiles one to a row.
 *
 * @pattern Variant — whether the tiles go across or one to a row is a closed Tamagui variant
 */
const Tiles = styled(XStack, {
    name: 'DetailFactRow',
    gap: '$2',

    variants: {
        stacked: {
            true: { flexDirection: 'column' },
        },
    } as const,
});

/**
 * One tile. Across, it shares the row and holds its label over its value; stacked, it takes the row and holds the label at the
 * start and the value at the end.
 *
 * @pattern Variant — the tile's arrangement is a closed Tamagui variant
 */
const Tile = styled(YStack, {
    name: 'DetailFactTile',
    flex: 1,
    gap: '$1',
    padding: '$3',
    borderRadius: '$lg',
    backgroundColor: '$coverSteel',

    variants: {
        stacked: {
            true: { flex: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '$3' },
        },
    } as const,
});

const LabelRow = styled(XStack, { name: 'DetailFactLabel', alignItems: 'center', gap: '$1' });

/** Props for {@link DetailFactTiles}. */
export interface DetailFactTilesProps {
    /** The tiles `detailStatCells` derived, in display order. */
    readonly tiles: readonly DetailStatCell[];
    /** The room the tiles are drawn in. */
    readonly layout: Pick<DetailNativeLayout, 'bodyWidth' | 'textScale'>;
}

/** The native fact tiles. */
export const DetailFactTiles: FC<DetailFactTilesProps> = ({ tiles, layout }) => {
    if (tiles.length === 0) {
        return null;
    }

    const stacked = columnsKeepingMinOf(layout.bodyWidth, layout.textScale, TILES_ACROSS(tiles.length)) < tiles.length;

    return (
        <Tiles stacked={stacked}>
            {tiles.map((tile) => (
                // `collapsable={false}`: a named View must stay in the native tree (`nativeLabelledViews`).
                <Tile
                    key={tile.id}
                    stacked={stacked}
                    collapsable={false}
                    role="group"
                    aria-label={`${tile.label}: ${tile.value}`}
                >
                    <LabelRow>
                        <Icon name={GLYPH[tile.id]} size={16} tone="inkMuted" />
                        <Text typeRole="caption" color="$inkMuted">
                            {tile.label}
                        </Text>
                    </LabelRow>
                    <Text typeRole="figureStat">{tile.value}</Text>
                </Tile>
            ))}
        </Tiles>
    );
};
