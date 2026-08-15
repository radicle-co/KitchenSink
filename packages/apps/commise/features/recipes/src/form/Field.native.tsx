/**
 * @module @commise/features-recipes/form — `Field` (native): the labeled field wrapper (a visible label above
 * its control) the native recipe-form field groups build their Basics inputs from. There is no web
 * counterpart — the web leaves use a `<label>` element directly.
 */
import type { FC, ReactNode } from 'react';
import { Text, View } from 'react-native';

import { styles } from './formSectionStyles.native.js';

/** A labeled field wrapper (visible label above its control) for the Basics section. */
export const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
    <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {children}
    </View>
);
