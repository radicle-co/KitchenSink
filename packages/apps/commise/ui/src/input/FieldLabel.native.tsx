/**
 * @module @commise/ui/input — the native design-system {@link FieldLabel}: the visible label above every field
 * (`label` role, `inkMuted`), carrying the `nativeID` its field's `aria-labelledby` names (`fieldLabelId`), with an
 * optional `caption` hint whose id the field's `describedBy` names (`fieldHintId`).
 *
 * Pressing the label focuses its field, as a web `<label for>` does (`@commise/ui/text-input`'s label registry). The
 * press area is not an accessibility element: the field is already named by the label and reached on its own, so the
 * label adds no stop and no role, the web label's behaviour too.
 *
 * @pattern Template — the label half of the field geometry, shared by every text field
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { focusLabelledField } from '../textInput/labelFocus.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { fieldHintId, fieldLabelId, type FieldLabelProps } from './props.js';

/** The native design-system field label. */
export const FieldLabel: FC<FieldLabelProps> = ({ forId, label, hint }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.stack}>
            <Pressable accessible={false} onPress={() => focusLabelledField(forId)}>
                <Text nativeID={fieldLabelId(forId)} style={[styles.label, { color: colors.inkMuted }]}>
                    {label}
                </Text>
            </Pressable>
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
