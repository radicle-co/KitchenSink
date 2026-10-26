/**
 * @module @commise/features-recipes/form — `PasteChoicePane` (native): the React Native leaf of `./PasteChoicePane.tsx`,
 * the side pane a 1194 tablet shows: which line it shows out of all the recipe's lines (M4), the line as a header, its
 * prompt, a pick that did not save with Try again, the line's `FoodChoiceList`, then Previous and Next open line,
 * always drawn and refused at an end. Painted from the theme's roles (D15).
 *
 * The pane carries NO name of its own: the web `aside`'s "Choose a food" only repeats a landmark, which on native is one
 * more swipe stop with no new fact, and the line's header already names the pane (`docs/design/nativeContainerNames.md`
 * N1 rules 2, 3 and 6; staff-ux 2026-10-25). With no name and no role it keeps no native node either.
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FoodChoiceList } from '../ingredientMatching/FoodChoiceList.native.js';
import { MatchFailureLine } from '../ingredientMatching/MatchFailureLine.native.js';
import { useRetryFocus } from '../ingredientMatching/useRetryFocus.js';
import type { PasteChoicePaneProps } from './pasteChoicePaneProps.js';

/** The side pane. */
export const PasteChoicePane: FC<PasteChoicePaneProps> = ({ view, onPrevious, onNext, onRetryPick, ...list }) => {
    const { colors } = useTheme();
    const retry = useRetryFocus([view.open.send])(view.open.send.key);

    return (
        <View style={styles.pane}>
            <View style={styles.head}>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{view.position}</Text>
                <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
                    {view.heading}
                </Text>
                {view.open.prompt === undefined ? null : (
                    <Text style={[styles.meta, { color: colors.inkMuted }]}>{view.open.prompt}</Text>
                )}
                {view.open.failure === undefined ? null : (
                    <MatchFailureLine failure={view.open.failure} onRetry={onRetryPick} focus={retry.tryAgain} />
                )}
            </View>
            <FoodChoiceList view={view.open.list} landing={retry.landing} {...list} />
            <View style={styles.steps}>
                <Button variant="ghost" icon="chevronLeft" refused={view.previous.disabled} onPress={onPrevious}>
                    {view.previous.label}
                </Button>
                <Button
                    variant="ghost"
                    icon="chevronRight"
                    iconPlacement="end"
                    refused={view.next.disabled}
                    onPress={onNext}
                >
                    {view.next.label}
                </Button>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    pane: { gap: nativeTokens.spacing[3], padding: nativeTokens.spacing[4] },
    head: { gap: nativeTokens.spacing[1] },
    heading: { ...nativeTokens.type.cardTitle },
    meta: { ...nativeTokens.type.list },
    steps: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[2],
    },
});
