/**
 * @module @commise/features-recipes/form — `PastedSourceNotice` (native): the presentational React Native leaf of
 * `./PastedSourceNotice.tsx`, on the same props and words. Styled with Tamagui only (ADR-0080). The Remove hugs its label
 * at the start of the row rather than stretching across it.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { editorMessages } from '../editor/messages.js';
import type { PastedSourceNoticeProps } from './pastedSourceNoticeProps.js';

/** What a paste did to the Source, under the paste control. */
export const PastedSourceNotice: FC<PastedSourceNoticeProps> = ({ text, onRemove }) => {
    const { source: m } = useMessages(editorMessages);

    return (
        <YStack gap="$1" alignItems="flex-start">
            <Text typeRole="meta" color="$inkMuted">
                {text}
            </Text>
            {onRemove === undefined ? null : (
                <Button variant="ghost" onPress={onRemove}>
                    {m.snackRemove}
                </Button>
            )}
        </YStack>
    );
};
