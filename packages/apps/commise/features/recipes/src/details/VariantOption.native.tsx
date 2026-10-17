/**
 * @module details/VariantOption — one row of the details dialog's list, native (curated U14;
 * `docs/design/ingredientSpecialization.md` §S8.2 "Row", §S8.4, §S10).
 *
 * A presentational leaf, pure `props → JSX`: a `Pressable` with the button role, whose `selected` state marks the line's current
 * variant (React Native has no listbox option). It shows the parts, the `Current` word under them, and the calories
 * at the end, which wrap under the parts below 12rem of room, scaled by the text size. A tap commits.
 */
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** Props of one option. */
export interface VariantOptionProps {
    readonly parts: readonly [string, ...string[]];
    /** The accessible name (`variantOptionName`). */
    readonly name: string;
    /** The visible calorie text. */
    readonly calories: string;
    /** Whether this is the line's current variant: a check glyph and the word `Current` (never colour alone). */
    readonly isCurrent: boolean;
    /** The word under a current row's parts. */
    readonly currentTag: string;
    /** Whether the list draws a check column: only when a LISTED row is current. */
    readonly hasCheckColumn: boolean;
    /** The device's text size (`useWindowDimensions().fontScale`): the parts' basis grows with it. */
    readonly fontScale: number;
    readonly onPick: () => void;
}

/** The parts' flex basis in body text sizes: the web row's `12rem` (§S8.2 "Row"). */
const PARTS_BASIS_IN_BODY_SIZES = 12;

export const VariantOption: FC<VariantOptionProps> = ({
    parts,
    name,
    calories,
    isCurrent,
    currentTag,
    hasCheckColumn,
    fontScale,
    onPick,
}) => {
    // Colour from the theme at render (D15): the press wash is `ink` at 6% (the web twin's `hover:bg-ink/6`).
    const { colors, wash } = useTheme();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={name}
            // React Native maps `aria-selected` to `accessibilityState.selected`; react-native-web renders it as is.
            aria-selected={isCurrent}
            onPress={onPick}
            style={({ pressed }) => [styles.row, pressed ? { backgroundColor: wash } : null]}
        >
            {hasCheckColumn && (
                <View style={styles.check} aria-hidden>
                    {isCurrent && <Icon name="check" size={16} tone="actionText" />}
                </View>
            )}
            <View style={styles.body}>
                <View
                    style={[
                        styles.parts,
                        { flexBasis: PARTS_BASIS_IN_BODY_SIZES * nativeTokens.fontSize.bodyMd * fontScale },
                    ]}
                >
                    <VariantPartsLine parts={parts} tone="primary" />
                    {isCurrent && <Text style={[styles.currentTag, { color: colors.actionText }]}>{currentTag}</Text>}
                </View>
                <Text style={[styles.calories, { color: colors.inkMuted }]}>{calories}</Text>
            </View>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        minHeight: 48,
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    check: { width: 16, paddingTop: nativeTokens.spacing[1] },
    body: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        columnGap: nativeTokens.spacing[3],
    },
    parts: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    currentTag: { fontSize: nativeTokens.fontSize.caption, fontWeight: '600' },
    calories: {
        marginStart: 'auto',
        fontSize: nativeTokens.fontSize.bodySm,
        fontVariant: ['tabular-nums'],
    },
});
