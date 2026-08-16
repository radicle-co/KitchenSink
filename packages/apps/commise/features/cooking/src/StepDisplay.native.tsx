/**
 * @module @commise/features-cooking/StepDisplay — the native Cooking Mode step surfaces (FR-032, SC-007).
 *
 * The React Native leaves of the web {@link import('./StepDisplay').StepDisplay} family — same prop
 * contract (`stepDisplayModel.ts`), same state split, same copy. Four single-responsibility presentational
 * components (`props → JSX`, no fetching, no mutation, no refs), one per render state, which the
 * orchestrating `CookingModeScreen` selects between:
 *  - {@link StepDisplayLoading} — the recipe is still arriving;
 *  - {@link StepDisplayEmpty} — the recipe loaded but has NO steps;
 *  - {@link StepDisplayError} — the load failed, with a retry the orchestrator owns;
 *  - {@link StepDisplay} — the populated surface: position readout, optional image, instruction.
 *
 * **Pattern register.** Same B15 split as the web leaves and as `RecipeRatingControl.native` — a
 * behaviour-switching `mode`/boolean prop is forbidden, so the orchestrator does the choosing. The shared
 * chrome lives once in the internal `StateBlock`. Type and colour come from `@commise/ui`'s
 * `nativeTokens` / `palette`, never from a magic number: the instruction is drawn at the `displayLg` ramp
 * step (36px, over plan.md §6's 32sp floor) and every other line at `headingLg` (24px).
 *
 * **Accessibility (NFR-003/NFR-004).** Every perceivable element is reachable by role or accessible name:
 * the position readout is a `header`, the image carries the position as its label, loading is a `status`
 * and failure an `alert`, and the instruction carries the dictionary's `instructionLabel`. One idiom
 * difference from web is deliberate: web names the step REGION and leaves the instruction a bare `<p>`
 * (ARIA prohibits naming a `paragraph`), while native — whose `Text` has no such restriction — names the
 * instruction element itself. Both platforms therefore expose the same name; only the host differs.
 *
 * The same two gaps the web leaf documents apply here: `RecipeStepView` carries no image field, so `imageUrl`
 * is supplied by the orchestrator (GR-007 / D-003 forbid a local recipe-shaped type), and the dictionary
 * has no dedicated step-photo alt-text key, so the image is named with the step POSITION rather than a
 * hard-coded literal.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { palette } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import type { FC, ReactNode } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { cookingMessages } from './messages';
import { formatStepPosition, type StepDisplayErrorProps, type StepDisplayProps } from './stepDisplayModel';

/** The retry glyph for the error surface's action. Decorative — the Button's label owns the name. */
const RetryGlyph: FC = () => (
    <Text aria-hidden style={styles.buttonGlyph}>
        ↻
    </Text>
);

/**
 * The shared block the three non-populated states paint: the same gutters and rhythm as the step surface,
 * so switching state does not shift the layout under the cook's hands. Keeps that chrome in one place
 * (DRY) — the states differ only in the content they pass as `children`.
 */
const StateBlock: FC<{ children: ReactNode; role?: 'status' | 'alert'; label?: string }> = ({
    children,
    role,
    label,
}) => (
    <View role={role} aria-label={label} style={styles.stateBlock}>
        {children}
    </View>
);

/** The step surface while the recipe is still arriving. Announces itself as a live `status`. */
export const StepDisplayLoading: FC = () => {
    const messages = useMessages(cookingMessages);

    return (
        <StateBlock role="status" label={messages.loadingLabel}>
            <View style={styles.row}>
                <ActivityIndicator aria-hidden color={palette.slate} />
                <Text style={styles.stateBody}>{messages.loadingLabel}</Text>
            </View>
        </StateBlock>
    );
};

/**
 * The step surface for a recipe that has NO steps — an honest dead end rather than a blank screen or a
 * fabricated "Step 1 of 0". Not an error: nothing failed, there is simply nothing to cook along with.
 */
export const StepDisplayEmpty: FC = () => {
    const messages = useMessages(cookingMessages);

    return (
        <StateBlock>
            <Text accessibilityRole="header" style={styles.emptyTitle}>
                {messages.emptyTitle}
            </Text>
            <Text accessibilityLabel={messages.emptyBody} style={styles.stateBody}>
                {messages.emptyBody}
            </Text>
        </StateBlock>
    );
};

/**
 * The step surface for a recipe that could not be loaded: the reason, paired with a glyph, plus a retry
 * that reports upward. The retry itself belongs to the orchestrator — this leaf performs no fetching.
 */
export const StepDisplayError: FC<StepDisplayErrorProps> = ({ onRetry }) => {
    const messages = useMessages(cookingMessages);

    return (
        <StateBlock role="alert">
            <View style={styles.row}>
                <Text aria-hidden style={styles.alertGlyph}>
                    ⚠
                </Text>
                <Text accessibilityLabel={messages.errorBody} style={styles.errorBody}>
                    {messages.errorBody}
                </Text>
            </View>
            <Button variant="secondary" icon={<RetryGlyph />} onPress={onRetry}>
                {messages.retryLabel}
            </Button>
        </StateBlock>
    );
};

/**
 * The populated Cooking Mode step: the localized position readout, an optional illustration, and the
 * instruction itself at the display ramp so it reads from ~3 feet (SC-007).
 */
export const StepDisplay: FC<StepDisplayProps> = ({ step, stepCount, imageUrl }) => {
    const messages = useMessages(cookingMessages);
    const locale = useLocale();
    const position = formatStepPosition(messages.stepPosition, { current: step.stepNumber, total: stepCount }, locale);

    return (
        <View style={styles.container}>
            {imageUrl !== undefined && (
                <Image
                    // Named distinctly from the position heading below it, or a screen reader
                    // announces the same string twice.
                    accessibilityLabel={formatStepPosition(
                        messages.stepImageLabel,
                        { current: step.stepNumber, total: stepCount },
                        locale,
                    )}
                    source={{ uri: imageUrl }}
                    resizeMode="cover"
                    style={styles.image}
                />
            )}
            <Text accessibilityRole="header" style={styles.position}>
                {position}
            </Text>
            <Text accessibilityLabel={messages.instructionLabel} style={styles.instruction}>
                {step.instruction}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        gap: nativeTokens.spacing[5],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[5],
    },
    stateBlock: {
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[6],
        alignItems: 'flex-start',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[3] },
    image: {
        width: '100%',
        height: nativeTokens.mediaHeight.hero,
        borderRadius: nativeTokens.radius.lg,
    },
    position: {
        fontSize: nativeTokens.fontSize.headingLg,
        lineHeight: nativeTokens.fontSize.headingLg * nativeTokens.lineHeight.heading,
        fontWeight: '600',
        color: palette.slate,
    },
    // SC-007 — the one line a cook reads from across the kitchen, so it takes the largest ramp step the
    // layout can carry (36px, over plan.md §6's 32sp floor) and the tighter heading leading.
    instruction: {
        fontSize: nativeTokens.fontSize.displayLg,
        lineHeight: nativeTokens.fontSize.displayLg * nativeTokens.lineHeight.heading,
        fontWeight: '500',
        color: palette.charcoal,
    },
    emptyTitle: {
        fontSize: nativeTokens.fontSize.displayMd,
        lineHeight: nativeTokens.fontSize.displayMd * nativeTokens.lineHeight.heading,
        fontWeight: '600',
        color: palette.charcoal,
    },
    stateBody: {
        fontSize: nativeTokens.fontSize.headingLg,
        lineHeight: nativeTokens.fontSize.headingLg * nativeTokens.lineHeight.body,
        color: palette.slate,
    },
    errorBody: {
        fontSize: nativeTokens.fontSize.headingLg,
        lineHeight: nativeTokens.fontSize.headingLg * nativeTokens.lineHeight.body,
        color: palette['error-dark'],
    },
    alertGlyph: { fontSize: nativeTokens.fontSize.headingLg, color: palette['error-dark'] },
    buttonGlyph: { fontSize: nativeTokens.fontSize.bodyLg, color: palette.coral },
});
