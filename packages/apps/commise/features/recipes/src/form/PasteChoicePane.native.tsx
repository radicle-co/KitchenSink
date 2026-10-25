/**
 * @module @commise/features-recipes/form — `PasteChoicePane` (native): the React Native leaf of `./PasteChoicePane.tsx`,
 * the side pane a 1194 tablet shows. A view named for what it does, which keeps its native node so Android does not
 * flatten the name away (`docs/design/nativeContainerNames.md` N1), its line as a header, the line's
 * `FoodChoiceList`, then Previous and Next open line, always drawn and disabled at an end. Painted from the theme's
 * roles (D15).
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FoodChoiceList } from './FoodChoiceList.native.js';
import type { PasteChoicePaneProps } from './pasteChoicePaneProps.js';

/** The side pane. */
export const PasteChoicePane: FC<PasteChoicePaneProps> = ({ view, onPrevious, onNext, ...list }) => {
    const { colors } = useTheme();

    return (
        <View collapsable={false} aria-label={view.label} style={styles.pane}>
            <View style={styles.head}>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{view.position}</Text>
                <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
                    {view.heading}
                </Text>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{view.open.prompt}</Text>
            </View>
            <FoodChoiceList view={view.open} {...list} />
            <View style={styles.steps}>
                <Button variant="ghost" icon="chevronLeft" disabled={view.previous.disabled} onPress={onPrevious}>
                    {view.previous.label}
                </Button>
                <Button
                    variant="ghost"
                    icon="chevronRight"
                    iconPlacement="end"
                    disabled={view.next.disabled}
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
    meta: { ...nativeTokens.type.meta },
    steps: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[2],
    },
});
