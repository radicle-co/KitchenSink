/**
 * @module @commise/features-recipes/form — `GroupNameField` (native): the inline name field of "+ Add a group" and
 * Rename group (build spec §7.5.5). The React Native leaf of `./GroupNameField.tsx`: the keyboard's done key saves.
 *
 * Presentational: `props → JSX` over the field's view (`GroupNameFieldView`).
 */
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import type { GroupNameFieldView } from './useIngredientGroups.js';

/** The inline group-name field. */
export const GroupNameField: FC<{ readonly field: GroupNameFieldView }> = ({ field }) => (
    <View style={styles.stack}>
        <FieldLabel forId={field.id} label={field.label} />
        <Input
            id={field.id}
            value={field.value}
            onChangeText={field.onChange}
            onSubmit={field.onSubmit}
            enterKeyHint="done"
            autoCapitalize="sentences"
            focusRequested={field.focusRequested}
            onFocusRequestHandled={field.onFocusRequestHandled}
        />
        <View style={styles.actions}>
            <Button variant="ghost" onPress={field.onCancel}>
                {field.cancelLabel}
            </Button>
            <Button variant="secondary" icon="check" onPress={field.onSubmit}>
                {field.saveLabel}
            </Button>
        </View>
    </View>
);

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[2] },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: nativeTokens.spacing[2] },
});
