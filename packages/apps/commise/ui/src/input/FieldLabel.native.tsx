/**
 * @module @commise/ui/input — the native design-system {@link FieldLabel}: the visible label above every field
 * (`label` role, `inkMuted`), carrying the `nativeID` its field's `aria-labelledby` names (`fieldLabelId`), with an
 * optional `caption` hint whose id the field's `describedBy` names (`fieldHintId`).
 *
 * Pressing the label focuses its field, as a web `<label for>` does (`@commise/ui/text-input`'s label registry). The
 * press area is not an accessibility element: the field is already named by the label and reached on its own, so the
 * label adds no stop and no role, the web label's behaviour too.
 *
 * Both texts are the design-system Text, so they grow with the system scale, size and leading together (ADR-0080 §8).
 *
 * @pattern Template — the label half of the field geometry, shared by every text field
 */
import type { FC } from 'react';
import { Pressable } from 'react-native';
import { YStack } from 'tamagui';

import { Text } from '../text/Text.native.js';
import { focusLabelledField } from '../textInput/labelFocus.native.js';
import { fieldHintId, fieldLabelId, type FieldLabelProps } from './props.js';

/** The native design-system field label. */
export const FieldLabel: FC<FieldLabelProps> = ({ forId, label, hint }) => (
    <YStack gap="$1">
        <Pressable accessible={false} onPress={() => focusLabelledField(forId)}>
            <Text typeRole="label" color="$inkMuted" id={fieldLabelId(forId)}>
                {label}
            </Text>
        </Pressable>
        {hint === undefined ? null : (
            <Text typeRole="caption" color="$inkMuted" id={fieldHintId(forId)}>
                {hint}
            </Text>
        )}
    </YStack>
);
