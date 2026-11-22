/**
 * @module @commise/ui/cooking-timer-row — the native {@link CookingTimerSummary}: the body of a cooking timer row. A
 * timer glyph, the time, an optional status word and what the timer is for. The glyph is dropped above 1.3x text
 * (`showsLeadingGlyph`) so the time keeps its room; the time never wraps and the meta does. Styled with Tamagui only
 * (ADR-0080).
 *
 * It is ONE accessibility element named by the caller's `accessibilityLabel`, and not a live region.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Slot — a part that fills the row frame's `body` slot
 */
import type { FC } from 'react';
import { styled, View } from 'tamagui';

import { Icon } from '../icon/Icon.native.js';
import { showsLeadingGlyph } from '../text/scaledType.js';
import { Text, useTextScale } from '../text/Text.native.js';
import type { CookingTimerSummaryProps } from './props.js';

/** The summary's row: glyph, then the text column. */
const Summary = styled(View, {
    name: 'CookingTimerSummary',
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
});

/** The text column: the time over the status and the meta. */
const Column = styled(View, {
    name: 'CookingTimerSummaryColumn',
    flex: 1,
    flexShrink: 1,
});

/** The native cooking timer summary part. */
export const CookingTimerSummary: FC<CookingTimerSummaryProps> = ({ figure, status, meta, accessibilityLabel }) => {
    const textScale = useTextScale();

    return (
        <Summary accessible aria-label={accessibilityLabel}>
            {showsLeadingGlyph(textScale) ? <Icon name="timer" size={24} tone="ink" growsWithText /> : null}
            <Column>
                <Text typeRole="figureLarge" numberOfLines={1} flexShrink={0}>
                    {figure}
                </Text>
                {status === undefined ? null : (
                    <Text typeRole="label" color="$inkMuted">
                        {status}
                    </Text>
                )}
                <Text typeRole="meta" color="$inkMuted">
                    {meta}
                </Text>
            </Column>
        </Summary>
    );
};
