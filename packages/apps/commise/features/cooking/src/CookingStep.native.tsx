/**
 * @module CookingStep — a cooking step's body on native: a region named by the place, holding the step
 * track, the collapsed record of ticked lines with Show, the "Line n of N" overline (absent for a one-line step), the
 * focus line, the "Then" lines, and, once every line is ticked, Up next (the next step's first line at the focus size,
 * then its other lines), in that reading order. The preview of the next step is not here: it is pinned in the foot.
 *
 * Which line is the focus and which are ticked is decided by the screen from cooking-core's line ticks; this leaf draws
 * what it is handed and reports presses. The track is decoration: the place in the top bar says the same thing, so it is
 * hidden from assistive tech. Up next is read-only text, never a control.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { styled, XStack, YStack } from 'tamagui';

import { CookingLineRow } from './CookingLineRow.native.js';
import type { CookingStepProps } from './cookingViewProps.js';
import { FOCUS_LINE_TYPE } from './focusLineType.js';

/** Where a step sits against the current one. */
type SegmentState = 'done' | 'now' | 'later';

/** One segment of the step track: its colour says done, now or later. */
const Segment = styled(YStack, {
    name: 'CookingStepSegment',
    flex: 1,
    height: 4,
    borderRadius: '$full',
    variants: {
        state: {
            done: { backgroundColor: '$inkMuted' },
            now: { backgroundColor: '$hereBar' },
            later: { backgroundColor: '$lineDivider' },
        } satisfies Record<SegmentState, object>,
    } as const,
});

/** Where a step (1-based) sits against the current one. Pure. */
function segmentState(step: number, current: number): SegmentState {
    if (step < current) {
        return 'done';
    }

    return step === current ? 'now' : 'later';
}

/** Native's props: the shared ones, plus the screen's request that the focus line takes the screen-reader cursor. */
export type NativeCookingStepProps = CookingStepProps & {
    readonly focusRequested?: boolean;
    readonly onFocusHandled?: () => void;
};

/** The native step body. */
export const CookingStep: FC<NativeCookingStepProps> = ({
    label,
    track,
    lineOf,
    ticked,
    focus,
    then,
    upNext,
    focusRequested = false,
    onFocusHandled,
}) => (
    <YStack role="region" aria-label={label} collapsable={false} gap="$4" paddingHorizontal="$4" paddingVertical="$3">
        <XStack testID="cooking-step-track" aria-hidden gap="$1">
            {Array.from({ length: track.total }, (_, index) => (
                <Segment key={index} state={segmentState(index + 1, track.position)} />
            ))}
        </XStack>
        {ticked === undefined ? null : (
            <YStack gap="$2">
                <XStack alignItems="center" gap="$2" flexWrap="wrap">
                    <Text typeRole="meta" color="$inkMuted">
                        {ticked.summary}
                    </Text>
                    <Button variant="ghost" size="md" expanded={ticked.expanded} onPress={ticked.show.onPress}>
                        {ticked.show.label}
                    </Button>
                </XStack>
                {ticked.expanded
                    ? ticked.lines.map((line) => <CookingLineRow key={line.key} line={line} emphasis="other" />)
                    : null}
            </YStack>
        )}
        {lineOf === undefined ? null : (
            <Text typeRole="meta" color="$inkMuted">
                {lineOf}
            </Text>
        )}
        {focus === undefined ? null : (
            <CookingLineRow
                line={focus}
                emphasis="focus"
                focusRequested={focusRequested}
                onFocusHandled={onFocusHandled}
            />
        )}
        {then.map((line) => (
            <CookingLineRow key={line.key} line={line} emphasis="other" />
        ))}
        {upNext === undefined ? null : (
            <YStack gap="$2" paddingTop="$2">
                <Text typeRole="label" color="$actionText">
                    {upNext.overline}
                </Text>
                <Text typeRole={FOCUS_LINE_TYPE.nativeTypeRole} color="$ink">
                    {upNext.lead}
                </Text>
                {upNext.rest.map((text, index) => (
                    // The next step's later lines in order; their index is their identity within Up next.
                    <Text key={`${String(index)}:${text}`} typeRole="readingBody" color="$ink">
                        {text}
                    </Text>
                ))}
            </YStack>
        )}
    </YStack>
);
