/**
 * @module @commise/features-recipes/form — the native `CandidatesPanelBody`, the panel body of rows 6 and 7 (SPECIFY.1),
 * presentational and the web body's twin: it draws the view `shortlistPanelOf` derives from the progressive food search
 * and hands each press to its host (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P10 and P12).
 *
 * - The view's own explanation, then what the search holds: one labelled group per source of foods, our database's
 *   first and each remote source's after under header text naming it, one 48 dp button per food; or one sentence for
 *   loading, offline, empty or a failed read, the failure assertive with Try again.
 * - After the groups, one polite line: the waiting line while the answer runs, then what could not be searched and each
 *   source's note, so it speaks once, when the answer ends (P7, per row). Frames only add groups after the last, so a
 *   cook's finger in the list stays on its food (P10).
 * - A pick's failure or the cook's limit is said assertively, the limit again at each refused press (R8).
 * - None of these is always last, so the cook is never left without a way on (§3a).
 *
 * @pattern Visitor — an exhaustive switch over the view's body union
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { Feather } from '@expo/vector-icons';
import type { FC, ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CandidateOption, CandidatesPanelBody as Body, CandidatesPanelBodyProps } from './candidatesPanel.js';
import { recipeFormMessages } from './messages.js';

/** Rows 6 and 7's panel body: the candidates, a pick per candidate, and None of these. */
export const CandidatesPanelBody: FC<CandidatesPanelBodyProps> = ({ view, onPick, onRetryRead, onNoneOfThese }) => {
    const m = useMessages(recipeFormMessages);

    const optionOf = (option: CandidateOption): ReactElement => (
        <Pressable
            key={option.candidateId}
            accessibilityRole="button"
            accessibilityLabel={option.accessibleName}
            aria-busy={option.busy}
            // React Native's busy control is `disabled`: it keeps its place and the reading cursor.
            disabled={option.busy || option.blocked}
            onPress={() => onPick(option.candidateId)}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
        >
            <Text style={styles.text}>{option.name}</Text>
            {option.summary !== undefined && <Text style={styles.hint}>{option.summary}</Text>}
        </Pressable>
    );

    const contentOf = (body: Body): ReactElement => {
        switch (body.kind) {
            case 'list': {
                const line = body.waiting ?? body.notes.join(' ');

                return (
                    <>
                        {body.groups.map((group) =>
                            // A group's kind fixes `heading`, so a group never moves between these two shapes.
                            group.heading ? (
                                // Named by its header (`docs/design/nativeContainerNames.md` N1).
                                <View key={group.key}>
                                    <Text accessibilityRole="header" style={styles.heading}>
                                        {group.label}
                                    </Text>
                                    {group.options.map(optionOf)}
                                </View>
                            ) : (
                                // No text says this group's name, so the group carries it.
                                <View collapsable={false} key={group.key} accessibilityLabel={group.label}>
                                    {group.options.map(optionOf)}
                                </View>
                            ),
                        )}
                        <LiveRegion politeness="polite" style={styles.hint}>
                            {line}
                        </LiveRegion>
                    </>
                );
            }

            case 'failed':
                return (
                    <>
                        <LiveRegion politeness="assertive" style={styles.text}>
                            {body.text}
                        </LiveRegion>
                        <Button
                            variant="secondary"
                            icon={<Feather name="refresh-cw" size={16} color={palette.charcoal} />}
                            onPress={onRetryRead}
                        >
                            {m.statusActionRetry}
                        </Button>
                    </>
                );
            case 'loading':
            case 'offline':
                return (
                    <LiveRegion politeness="polite" style={styles.hint}>
                        {body.text}
                    </LiveRegion>
                );
            case 'empty':
                return <Text style={styles.hint}>{body.text}</Text>;
        }
    };

    return (
        <View style={styles.panel}>
            <Text style={styles.text}>{view.explanation}</Text>
            {contentOf(view.body)}
            <LiveRegion politeness="assertive" occurrence={view.alertOccurrence} style={styles.text}>
                {view.alert}
            </LiveRegion>
            <Button
                variant="secondary"
                icon={<Feather name="search" size={16} color={palette.charcoal} />}
                onPress={onNoneOfThese}
            >
                {m.statusActionNoneOfThese}
            </Button>
        </View>
    );
};

const styles = StyleSheet.create({
    panel: { gap: nativeTokens.spacing[2] },
    text: { color: palette.charcoal, fontSize: nativeTokens.fontSize.bodySm },
    hint: { color: palette.slate, fontSize: nativeTokens.fontSize.caption },
    heading: {
        color: palette.slate,
        fontSize: nativeTokens.fontSize.caption,
        fontWeight: '600',
        paddingHorizontal: nativeTokens.spacing[3],
        paddingTop: nativeTokens.spacing[2],
    },
    option: {
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.md,
    },
    pressed: { backgroundColor: palette.pearl },
});
