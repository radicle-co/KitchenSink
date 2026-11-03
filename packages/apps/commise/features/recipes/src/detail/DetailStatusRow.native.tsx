/**
 * @module @commise/features-recipes — the native recipe page's status row: the owner's visibility (or the Draft
 * badge) and the "Version history" link, on one line under the title. It draws nothing when it has neither.
 *
 * The two items sit in a wrapping row 16 apart each way, with no separator glyph (designer ruling): when the pair wraps
 * at 2x text, each stands on its own line, and nothing has to be measured.
 *
 * Presentational: props to JSX.
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import { Text } from '@commise/ui/text';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { styled, XStack } from 'tamagui';

import { recipeMessages } from '../messages.js';
import type { DetailStatus } from './detailFacts.js';

const Row = styled(XStack, { name: 'DetailStatusRow', flexWrap: 'wrap', alignItems: 'center', gap: '$4' });

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

    if (status === undefined && onViewVersions === undefined) {
        return null;
    }

    return (
        <Row>
            {status?.kind === 'draft' && <StatusBadge status="draft">{status.text}</StatusBadge>}
            {status?.kind === 'visibility' && (
                <Visibility>
                    <Icon name={status.visibility === 'public' ? 'globe' : 'lock'} size={16} tone="inkMuted" />
                    <Text typeRole="meta" color="$inkMuted">
                        {status.text}
                    </Text>
                </Visibility>
            )}
            {onViewVersions !== undefined && (
                <Button variant="ghost" size="sm" onPress={onViewVersions}>
                    {detail.versionHistory}
                </Button>
            )}
        </Row>
    );
};
