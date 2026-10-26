/**
 * @module @commise/features-recipes/ingredientMatching — `MatchClosedRow` (native): the React Native leaf of
 * `./MatchClosedRow.tsx`. The whole row is one `button`, 48 pt at least, that opens the line; it says the line and what
 * it needs in muted 14 pt words, or, when its choice did not save, that in attention with the warning glyph. The line
 * the side pane shows at 1194 is `selected`, drawn with the selected fill AND a 2 pt selected-edge ring (U10: the fill
 * alone is 1.2:1, under WCAG 1.4.11's 3:1); the ring's width never changes, only its colour, so the row never shifts.
 * While the line's choice is being sent the row is disabled (which keeps the screen-reader cursor on device) and refuses
 * to open (M1). Painted from the theme's roles (D15).
 */
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MatchLineText } from './MatchLineText.native.js';
import type { MatchClosedRowProps } from './matchClosedRowProps.js';

/** One collapsed open line. */
export const MatchClosedRow: FC<MatchClosedRowProps> = ({ line, need, current, refusing, failure, onOpen }) => {
    const { colors } = useTheme();

    return (
        <Pressable
            accessibilityRole="button"
            aria-selected={current}
            disabled={refusing}
            onPress={onOpen}
            style={({ pressed }) => [
                styles.row,
                current && { backgroundColor: colors.selectedFill, borderColor: colors.selectedEdge },
                pressed && { backgroundColor: colors.surfaceMuted },
            ]}
        >
            <View style={styles.text}>
                <MatchLineText line={line} />
                {failure === undefined ? (
                    <Text style={[styles.need, { color: colors.inkMuted }]}>{need}</Text>
                ) : (
                    <View style={styles.failure}>
                        <Icon name="triangleAlert" size={16} tone="attention" />
                        <Text style={[styles.need, { color: colors.attention }]}>{failure}</Text>
                    </View>
                )}
            </View>
            <Icon name="chevronRight" size={20} tone="inkMuted" />
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        minHeight: nativeTokens.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[1],
        paddingVertical: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
        // The current line's ring (U10). A constant width with a clear colour at rest, so marking a line never moves it.
        borderWidth: 2,
        borderColor: 'transparent',
    },
    text: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[1] },
    need: { ...nativeTokens.type.list, flexShrink: 1 },
    failure: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
});
