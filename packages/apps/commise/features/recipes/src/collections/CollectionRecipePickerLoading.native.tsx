/**
 * @module @commise/features-recipes — the native recipe-picker body while the caller's candidate recipes load,
 * rendered inside the `CollectionRecipePicker` frame by the composing app's read boundary.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { ScrollView, View } from 'react-native';

import { styles } from './collectionRecipePickerStyles.native.js';
import { collectionMessages } from './messages.js';

/** The presentational picker body while the candidates load. */
export const CollectionRecipePickerLoading: FC = () => {
    const { picker } = useMessages(collectionMessages);

    return (
        <ScrollView>
            <View accessibilityLabel={picker.loadingLabel} style={styles.stateCard} />
        </ScrollView>
    );
};
