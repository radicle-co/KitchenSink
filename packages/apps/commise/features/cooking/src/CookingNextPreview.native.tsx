/**
 * @module CookingNextPreview — the native Next preview: the next step's first line, pinned in the foot above Back and
 * Next while a line of this step is unticked. On a short screen (under 700 tall) the line shows on one line, ending in an
 * ellipsis; the cut is visual only, so a screen reader still reads the whole line. Whether the screen is short is the
 * screen's to say, because a leaf never reads the device.
 *
 * Presentational: props → JSX.
 *
 * @pattern Variant — `short` selects the one-line cut; it changes how the line is drawn, never what it says
 */
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import type { CookingNextPreviewProps } from './cookingViewProps.js';

/** Native's props: the shared contract's, plus whether the screen is under the short-screen height. */
export type NativeCookingNextPreviewProps = CookingNextPreviewProps & {
    readonly short: boolean;
};

/** The native Next preview. */
export const CookingNextPreview: FC<NativeCookingNextPreviewProps> = ({ preview, short }) => (
    <YStack gap="$1" paddingHorizontal="$4">
        <Text typeRole="label" color="$actionText">
            {preview.overline}
        </Text>
        <Text typeRole="body" color="$ink" {...(short ? { numberOfLines: 1 } : {})}>
            {preview.line}
        </Text>
    </YStack>
);
