/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (native): the private-visibility toggle.
 *
 * The React Native leaf of `./RecipeVisibilityField.tsx`. It belongs to step 1 but is split out from
 * `RecipeBasicsFields` because the wireframe's step-1 field list and `RecipeForm.native`'s original
 * layout both treat it as its own control, not part of the "Basics" card.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Switch, Text, View } from 'react-native';

import { recipeFormMessages } from './messages.js';
import { styles } from './formSectionStyles.native.js';
import type { RecipeFormSectionProps } from './props.js';

/** The private-visibility toggle — its own field (step 1) per the original `RecipeForm.native` layout. */
export const RecipeVisibilityField: FC<Omit<RecipeFormSectionProps, 'errors'>> = ({ values, onChange }) => {
    const m = useMessages(recipeFormMessages);

    return (
        <View style={styles.switchRow}>
            <Switch
                accessibilityLabel={m.visibilityLabel}
                value={values.visibility === 'private'}
                onValueChange={(next) => onChange({ ...values, visibility: next ? 'private' : 'public' })}
                trackColor={{ true: palette.seafoam, false: palette.mist }}
            />
            <Text style={styles.switchLabel}>{m.visibilityLabel}</Text>
        </View>
    );
};
