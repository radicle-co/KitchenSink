/**
 * @module @commise/features-cooking — the NATIVE {@link StepNavigation} render component (FR-033).
 *
 * The React Native leaf of `StepNavigation.tsx`: same {@link StepNavigationProps} contract, same
 * {@link stepNavigationModel} policy module, same states — so the two platforms cannot drift on where a
 * boundary is or what a dot means. Pure `props → JSX`: no step state, no fetching, no mutation, no refs.
 *
 * What this leaf adds over the web one is the SWIPE affordance, because a phone propped on a counter is
 * driven by the thumb, not a pointer. It is expressed as an **adapter**: a `PanResponder` translates raw
 * displacement into a navigation intent through the pure {@link swipeNavigation}, which applies the very
 * same boundary rules the tap zones obey. Two consequences are deliberate:
 *  - `onStartShouldSetPanResponder` returns `false`, so a plain TAP is never captured by the swipe layer and
 *    still reaches the zone underneath;
 *  - a swipe LEFT on the last step does NOT finish the session — ending a cook stays a deliberate press on
 *    the finish affordance (HAZ-006, accidental/wet-hand gestures).
 *
 * `PanResponder.create` is a pure factory over the callbacks; memoising it keeps the handler set stable
 * across renders without introducing a ref or any state of this component's own.
 *
 * Boundary presentation mirrors the web leaf in the native idiom: the previous control stays MOUNTED on the
 * first step and is marked disabled (which `PressScale`'s `Pressable` announces via `accessibilityState`,
 * and which blocks the press), with `atFirstStepLabel` rendered as a `status` region. On the last step the
 * forward zone is REPLACED by the design-system {@link Button} finish affordance, so `onNext` is
 * unreachable there. Progress is carried by a `progressbar` plus visible text, never by dot colour alone
 * (NFR-004). A recipe with zero steps renders nothing — that is the screen's empty state.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { PressScale } from '@commise/ui/press-scale';
import { palette } from '@commise/ui/tokens/colors';
import { useMemo, type FC } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import { cookingMessages } from './messages';
import {
    formatStepPosition,
    hasSteps,
    isAtFirstStep,
    isAtLastStep,
    stepDotStates,
    stepNumber,
    swipeNavigation,
    type StepDotState,
    type StepNavigationProps,
} from './stepNavigationModel';

/**
 * Per-state dot styling. The CURRENT dot differs in SIZE as well as tone, and the row is redundant with the
 * visible position text, so dot colour is never the sole conveyor of progress (NFR-004).
 */
const dotStyle: Record<StepDotState, { width: number; height: number; borderRadius: number; backgroundColor: string }> =
    {
        completed: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.seafoam },
        current: { width: 14, height: 14, borderRadius: 7, backgroundColor: palette.charcoal },
        upcoming: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.mist },
    };

/** Forward/backward traversal for Cooking Mode: two large tap zones, a swipe layer, and stated boundaries. */
export const StepNavigation: FC<StepNavigationProps> = ({ currentStep, totalSteps, onPrevious, onNext, onFinish }) => {
    const messages = useMessages(cookingMessages);
    const locale = useLocale();

    const responder = useMemo(
        () =>
            PanResponder.create({
                // A tap must fall through to the zone underneath — only a horizontal DRAG is ours.
                onStartShouldSetPanResponder: () => false,
                onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy),
                onPanResponderRelease: (_event, gesture) => {
                    const intent = swipeNavigation(gesture.dx, gesture.dy, currentStep, totalSteps);

                    if (intent === 'next') {
                        onNext();
                    } else if (intent === 'previous') {
                        onPrevious();
                    }
                },
            }),
        [currentStep, totalSteps, onNext, onPrevious],
    );

    if (!hasSteps(totalSteps)) {
        return null;
    }

    const atFirst = isAtFirstStep(currentStep, totalSteps);
    const atLast = isAtLastStep(currentStep, totalSteps);
    const position = formatStepPosition(messages.stepPosition, currentStep, totalSteps, locale);
    const dots = stepDotStates(currentStep, totalSteps);

    return (
        <View style={styles.container} {...responder.panHandlers}>
            <View style={styles.progress}>
                <View
                    role="progressbar"
                    aria-label={position}
                    aria-valuemin={1}
                    aria-valuemax={dots.length}
                    aria-valuenow={stepNumber(currentStep, totalSteps)}
                    aria-valuetext={position}
                    style={styles.dotRow}
                >
                    {dots.map((state, index) => (
                        <View key={index} aria-hidden style={dotStyle[state]} />
                    ))}
                </View>
                {/* NFR-004 — the dots are never the sole conveyor of position; the same fact is stated in text. */}
                <Text style={styles.position}>{position}</Text>
            </View>

            <View style={styles.zones}>
                <View style={styles.zone}>
                    <PressScale
                        onPress={onPrevious}
                        // `PressScale`'s `Pressable` both ANNOUNCES the unavailable state
                        // (`accessibilityState.disabled`) and refuses the press, so the first-step boundary is
                        // enforced by the primitive rather than by a hand-rolled guard.
                        disabled={atFirst}
                        accessibilityLabel={messages.previousLabel}
                    >
                        <View style={[styles.zoneSurface, atFirst ? styles.zoneDisabled : null]}>
                            <Text aria-hidden style={styles.chevron}>
                                ‹
                            </Text>
                            <Text style={styles.zoneLabel}>{messages.previousLabel}</Text>
                        </View>
                    </PressScale>
                </View>

                {atLast ? (
                    <View style={styles.finishZone}>
                        <Button
                            icon={
                                <Text aria-hidden style={styles.check}>
                                    ✓
                                </Text>
                            }
                            onPress={onFinish}
                        >
                            {messages.finishLabel}
                        </Button>
                    </View>
                ) : (
                    <View style={styles.zone}>
                        <PressScale onPress={onNext} accessibilityLabel={messages.nextLabel}>
                            <View style={styles.zoneSurface}>
                                <Text style={styles.zoneLabel}>{messages.nextLabel}</Text>
                                <Text aria-hidden style={styles.chevron}>
                                    ›
                                </Text>
                            </View>
                        </PressScale>
                    </View>
                )}
            </View>

            {atFirst && (
                <Text role="status" style={styles.hint}>
                    {messages.atFirstStepLabel}
                </Text>
            )}
            {atLast && (
                <Text role="status" style={styles.hint}>
                    {messages.atLastStepLabel}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { width: '100%', alignItems: 'center', gap: nativeTokens.spacing[3] },
    progress: { alignItems: 'center', gap: nativeTokens.spacing[2] },
    dotRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8 },
    position: {
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '500',
        color: palette.charcoal,
    },
    zones: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
    },
    // ~40% of the row per plan.md §4 — a kitchen-grade target for wet or occupied hands.
    zone: { width: '40%' },
    finishZone: { width: '40%', alignItems: 'center', justifyContent: 'center' },
    zoneSurface: {
        // 48dp floor, above WCAG 2.5.5's 44px minimum.
        minHeight: 48,
        minWidth: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: palette.mist,
        backgroundColor: palette.white,
        paddingVertical: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    zoneDisabled: { opacity: 0.5 },
    zoneLabel: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600', color: palette.charcoal },
    chevron: { fontSize: nativeTokens.fontSize.headingMd, color: palette.charcoal },
    check: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.white },
    hint: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
});
