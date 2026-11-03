/**
 * @module @commise/features-recipes — the native recipe page's status row: the owner's visibility (or the Draft
 * badge) and the "Version history" link, on one line under the title. It draws nothing when it has neither.
 *
 * The separator is drawn only while the two items share a line: when the pair wraps (2x text) each item stands alone, so
 * no "·" starts the second line. A layout cannot say that, so the row reads where each item laid out and compares their
 * top edges (state, no ref; the second being lower than the first is a wrap at any text size).
 *
 * Presentational: props to JSX, plus that one layout state.
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import { Text } from '@commise/ui/text';
import { useMessages } from '@commise/i18n/react';
import { useState, type FC } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { styled, XStack } from 'tamagui';

import { recipeMessages } from '../messages.js';
import type { DetailStatus } from './detailFacts.js';

const Row = styled(XStack, { name: 'DetailStatusRow', flexWrap: 'wrap', alignItems: 'center', columnGap: '$2' });

/** The version link, with the separator before it while the pair shares a line. */
const Unit = styled(XStack, { name: 'DetailStatusUnit', alignItems: 'center', columnGap: '$2' });

const Visibility = styled(XStack, { name: 'DetailVisibility', alignItems: 'center', gap: '$1' });

/** Props for {@link DetailStatusRow}. */
export interface DetailStatusRowProps {
    /** The owner's status; absent for another cook's viewer. */
    readonly status: DetailStatus | undefined;
    /** Open the version history; absent when the page offers none. */
    readonly onViewVersions: (() => void) | undefined;
}

/** The native status row. */
export const DetailStatusRow: FC<DetailStatusRowProps> = ({ status, onViewVersions }) => {
    const { detail } = useMessages(recipeMessages);
    const [tops, setTops] = useState<{ readonly first?: number; readonly second?: number }>({});
    const wrapped = tops.first !== undefined && tops.second !== undefined && tops.second > tops.first;
    const onFirst = ({ nativeEvent }: LayoutChangeEvent): void =>
        setTops((current) => ({ ...current, first: nativeEvent.layout.y }));
    const onSecond = ({ nativeEvent }: LayoutChangeEvent): void =>
        setTops((current) => ({ ...current, second: nativeEvent.layout.y }));

    if (status === undefined && onViewVersions === undefined) {
        return null;
    }

    return (
        <Row>
            {/* A bare View carries each layout report: Tamagui's own frames measure through their own observer. */}
            {status?.kind === 'draft' && (
                <View onLayout={onFirst}>
                    <StatusBadge status="draft">{status.text}</StatusBadge>
                </View>
            )}
            {status?.kind === 'visibility' && (
                <View onLayout={onFirst}>
                    <Visibility>
                        <Icon name={status.visibility === 'public' ? 'globe' : 'lock'} size={16} tone="inkMuted" />
                        <Text typeRole="meta" color="$inkMuted">
                            {status.text}
                        </Text>
                    </Visibility>
                </View>
            )}
            {onViewVersions !== undefined && (
                // A separator never ends a line: it is joined to the item after it as one unit, and dropped once the unit wraps.
                <View onLayout={onSecond}>
                    <Unit>
                        {status !== undefined && !wrapped && (
                            <Text typeRole="meta" color="$inkMuted" aria-hidden>
                                ·
                            </Text>
                        )}
                        <Button variant="ghost" size="sm" onPress={onViewVersions}>
                            {detail.versionHistory}
                        </Button>
                    </Unit>
                </View>
            )}
        </Row>
    );
};
