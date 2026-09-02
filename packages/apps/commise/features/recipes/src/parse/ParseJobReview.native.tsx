/**
 * @module @commise/features-recipes/parse — NATIVE review leaf.
 *
 * The React Native twin of `ParseJobReview.tsx`: the SAME {@link ParseJobViewState} union, switched
 * exhaustively, with the same rule about where the retry control may appear. Every judgement — which state
 * the surface is in, what a line's measure reads, whether a review reason is known — comes from
 * `model.ts`, so the only thing that differs between the platforms is markup.
 *
 * DESIGN PATTERN: discriminated union + exhaustive switch (Visitor, satisfied by the language) over pure
 * projections; presentational leaf with injected commands.
 *
 * ⛔ THE RETRY CONTROL IS OFFERED ONLY WHERE IT CAN DO SOMETHING — `settling` and `stalled`, never `ready`
 * (where it provably re-drives nothing) and never `expired` (where the server answers `409`).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette, semantic } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ParseJobLineView } from '@kitchensink/recipe-service-client';

import { fillTemplate } from '../list/model.js';
import { recipeParseMessages } from './messages.js';
import { toParseLineModel, type ParseLineTone } from './model.js';
import type { ParseJobReviewProps, ParseLineRowProps } from './props.js';

/** Tone → the colour that carries it. Exhaustive, so a new tone cannot render as default body text. */
const TONE_COLOR: Readonly<Record<ParseLineTone, string>> = {
    progress: palette.slate,
    success: palette['ocean-dark'],
    warning: palette.warning,
    error: palette['error-dark'],
};

/** RC-3's touch-target floor, in dp. */
const TOUCH_TARGET_DP = 44;

/** One review row — the mirror of the web `ParseLineRow`, down to which affordance appears when. */
const ParseLineRow: FC<ParseLineRowProps> = ({ line, edit, renderCorrection }) => {
    const messages = useMessages(recipeParseMessages);
    const locale = useLocale();
    const model = toParseLineModel(line, messages, locale);
    const [draft, setDraft] = useState<string | undefined>(undefined);
    const busy = edit.busyLineIndex === line.lineIndex;

    return (
        <View accessible accessibilityLabel={model.label} style={styles.row}>
            <View style={styles.rowHeader}>
                <Text style={styles.source}>{model.sourceLine}</Text>
                <Text style={[styles.status, { color: TONE_COLOR[model.tone] }]}>{model.statusLabel}</Text>
            </View>

            {model.measure !== undefined && <Text style={styles.measure}>{model.measure}</Text>}

            {model.foods?.map((food, index) => (
                <Text key={`${food.name}-${String(index)}`} style={styles.food}>
                    {food.prep === null ? food.name : `${food.name} · ${food.prep}`}
                </Text>
            ))}

            {/* A line that named no foods is a FACT (a heading is a legitimate line), not a failure. */}
            {model.emptyFoodsNotice !== undefined && <Text style={styles.muted}>{model.emptyFoodsNotice}</Text>}

            {model.reviewReasons.map((reason) => (
                <Text key={reason} style={styles.reason}>
                    {reason}
                </Text>
            ))}

            {/* ⛔ THE CORRECTION SEAM — offered only once a proposal has landed. See `props.ts`. */}
            {line.proposal !== null && renderCorrection?.(line)}

            {draft === undefined ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={model.editLabel}
                    // `aria-busy` is the only one of these that reaches the DOM — react-native-web
                    // projects `accessibilityState` for nothing. Both are kept: React Native reverse-maps
                    // the ARIA prop back into `accessibilityState` on device.
                    accessibilityState={{ disabled: busy, busy }}
                    aria-busy={busy}
                    disabled={busy}
                    onPress={() => setDraft(model.sourceLine)}
                    style={[styles.secondary, busy && styles.disabled]}
                >
                    <Text style={styles.secondaryLabel}>{model.editLabel}</Text>
                </Pressable>
            ) : (
                <View style={styles.editor}>
                    <Text style={styles.label}>{messages.lineEditLabel}</Text>
                    <TextInput
                        accessibilityLabel={messages.lineEditLabel}
                        value={draft}
                        onChangeText={setDraft}
                        style={styles.input}
                    />
                    <View style={styles.editorActions}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={messages.lineEditSubmit}
                            // ⛔ THE WIRE INDEX, never the number in the label. The row reads "line 4" and
                            // the API takes `3`; sending the human number edits a different line silently.
                            onPress={() => {
                                if (draft.trim() === '') {
                                    return;
                                }

                                edit.submit(line.lineIndex, draft);
                                setDraft(undefined);
                            }}
                            style={styles.primary}
                        >
                            <Text style={styles.primaryLabel}>{messages.lineEditSubmit}</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={messages.lineEditCancel}
                            onPress={() => setDraft(undefined)}
                            style={styles.secondary}
                        >
                            <Text style={styles.secondaryLabel}>{messages.lineEditCancel}</Text>
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    );
};

/** The line list — one row per submitted line, in submission order. */
const ParseLineList: FC<{
    readonly lines: readonly ParseJobLineView[];
    readonly edit: ParseJobReviewProps['edit'];
    readonly renderCorrection: ParseJobReviewProps['renderCorrection'];
}> = ({ lines, edit, renderCorrection }) => {
    const messages = useMessages(recipeParseMessages);

    return (
        <View accessibilityRole="list" accessibilityLabel={messages.lineListLabel} style={styles.list}>
            {lines.map((line) => (
                <ParseLineRow key={line.lineIndex} line={line} edit={edit} renderCorrection={renderCorrection} />
            ))}
        </View>
    );
};

export const ParseJobReview: FC<ParseJobReviewProps> = ({ state, retry, edit, onStartOver, renderCorrection }) => {
    const messages = useMessages(recipeParseMessages);

    const startOver = (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.startOverAction}
            onPress={onStartOver}
            style={styles.secondary}
        >
            <Text style={styles.secondaryLabel}>{messages.startOverAction}</Text>
        </Pressable>
    );

    const retryControl = (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.retryAction}
            accessibilityState={{ disabled: retry.busy, busy: retry.busy }}
            aria-busy={retry.busy}
            disabled={retry.busy}
            onPress={retry.run}
            style={[styles.primary, retry.busy && styles.disabled]}
        >
            <Text style={styles.primaryLabel}>{messages.retryAction}</Text>
        </Pressable>
    );

    const notices = (
        <>
            {retry.notice !== undefined && (
                <Text role="alert" style={styles.error}>
                    {retry.notice}
                </Text>
            )}
            {edit.notice !== undefined && (
                <Text role="alert" style={styles.error}>
                    {edit.notice}
                </Text>
            )}
        </>
    );

    switch (state.kind) {
        case 'loading':
            return (
                <Text role="status" style={styles.muted}>
                    {messages.loading}
                </Text>
            );

        case 'missing':
            return (
                <View style={styles.container}>
                    <Text role="alert" style={styles.error}>
                        {messages.missing}
                    </Text>
                    {startOver}
                </View>
            );

        case 'failed':
            return (
                <View style={styles.container}>
                    <Text role="alert" style={styles.error}>
                        {messages.failed}
                    </Text>
                    {startOver}
                </View>
            );

        // ⛔ NO RETRY HERE. The TTL has passed and the only remedy the server leaves is a fresh paste.
        case 'expired':
            return (
                <View style={styles.container}>
                    <Text role="alert" style={styles.error}>
                        {messages.expired}
                    </Text>
                    {startOver}
                </View>
            );

        case 'running':
        case 'stalled':
        case 'settling':
            return (
                <View style={styles.container}>
                    <Text accessibilityRole="header" style={styles.heading}>
                        {messages.reviewHeading}
                    </Text>
                    <Text role="status" accessibilityLabel={messages.progressLabel} style={styles.muted}>
                        {fillTemplate(messages.progressCount, {
                            settled: state.progress.settled,
                            total: state.progress.total,
                        })}
                    </Text>
                    <Text style={styles.muted}>
                        {state.kind === 'running'
                            ? messages.running
                            : state.kind === 'stalled'
                              ? messages.stalled
                              : messages.settling}
                    </Text>
                    {notices}
                    {retry.busy && (
                        <Text role="status" style={styles.muted}>
                            {messages.retrying}
                        </Text>
                    )}
                    {state.kind !== 'running' && (
                        <View style={styles.actions}>
                            {retryControl}
                            {startOver}
                        </View>
                    )}
                    <ParseLineList lines={state.job.lines} edit={edit} renderCorrection={renderCorrection} />
                </View>
            );

        case 'ready':
            return (
                <View style={styles.container}>
                    <Text accessibilityRole="header" style={styles.heading}>
                        {messages.reviewHeading}
                    </Text>
                    <Text role="status" accessibilityLabel={messages.progressLabel} style={styles.muted}>
                        {fillTemplate(messages.progressCount, {
                            settled: state.progress.settled,
                            total: state.progress.total,
                        })}
                    </Text>
                    <Text style={styles.muted}>{messages.ready}</Text>
                    {notices}
                    <ParseLineList lines={state.job.lines} edit={edit} renderCorrection={renderCorrection} />
                    {startOver}
                </View>
            );
    }
};

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[3] },
    heading: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    muted: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    error: { fontSize: nativeTokens.fontSize.bodySm, color: palette['error-dark'] },
    actions: { flexDirection: 'row', gap: nativeTokens.spacing[2] },
    list: { gap: nativeTokens.spacing[2] },
    row: {
        gap: nativeTokens.spacing[2],
        borderWidth: 1,
        borderColor: semantic.border,
        borderRadius: nativeTokens.radius.md,
        padding: nativeTokens.spacing[3],
        backgroundColor: palette.white,
    },
    rowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: nativeTokens.spacing[2] },
    source: { flex: 1, fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.charcoal },
    status: { fontSize: nativeTokens.fontSize.caption },
    measure: { fontSize: nativeTokens.fontSize.bodySm, color: palette.charcoal },
    food: { fontSize: nativeTokens.fontSize.bodySm, color: palette['ocean-dark'] },
    reason: { fontSize: nativeTokens.fontSize.caption, color: palette.charcoal },
    editor: { gap: nativeTokens.spacing[1] },
    editorActions: { flexDirection: 'row', gap: nativeTokens.spacing[2] },
    label: { fontSize: nativeTokens.fontSize.caption, color: palette.slate },
    input: {
        minHeight: TOUCH_TARGET_DP,
        borderWidth: 1,
        borderColor: semantic.border,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
        fontSize: nativeTokens.fontSize.bodySm,
        color: palette.charcoal,
        backgroundColor: palette.white,
    },
    primary: {
        minHeight: TOUCH_TARGET_DP,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[4],
        backgroundColor: palette.seafoam,
    },
    primaryLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
    secondary: {
        minHeight: TOUCH_TARGET_DP,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[4],
        backgroundColor: palette.pearl,
    },
    secondaryLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.slate },
    disabled: { opacity: 0.6 },
});
