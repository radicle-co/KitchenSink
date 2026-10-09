/**
 * @module @commise/ui/input — the native design-system {@link FieldLabel}: the visible label above every field
 * (`label` role, `inkMuted`), carrying the `nativeID` its field's `aria-labelledby` names (`fieldLabelId`), with an
 * optional `caption` hint whose id the field's `describedBy` names (`fieldHintId`).
 *
 * @pattern Template — the label half of the field geometry, shared by every text field
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { fieldHintId, fieldLabelId, type FieldLabelProps } from './props.js';

/** The native design-system field label. */
export const FieldLabel: FC<FieldLabelProps> = ({ forId, label, hint }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.stack}>
            <Text nativeID={fieldLabelId(forId)} style={[styles.label, { color: colors.inkMuted }]}>
                {label}
            </Text>
            {hint === undefined ? null : (
                <Text nativeID={fieldHintId(forId)} style={[styles.hint, { color: colors.inkMuted }]}>
                    {hint}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[1] },
    label: nativeTokens.type.label,
    hint: nativeTokens.type.caption,
});
