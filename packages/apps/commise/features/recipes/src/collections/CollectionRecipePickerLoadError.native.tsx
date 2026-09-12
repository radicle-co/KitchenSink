/**
 * @module @commise/features-recipes — the native recipe-picker body when the caller's candidate recipes failed to
 * load, rendered inside the `CollectionRecipePicker` frame by the composing app's read boundary.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { styles } from './collectionRecipePickerStyles.native.js';
import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerLoadErrorProps } from './model.js';

/** The presentational picker body when the candidates failed to load. */
export const CollectionRecipePickerLoadError: FC<CollectionRecipePickerLoadErrorProps> = ({ onRetry }) => {
    const { picker } = useMessages(collectionMessages);

    return (
        <ScrollView>
            <View accessibilityRole="alert" style={styles.stateCard}>
                <Text style={styles.stateTitle}>{picker.errorTitle}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={picker.retry}
                    onPress={onRetry}
                    style={styles.textButton}
                >
                    <Text style={styles.linkLabel}>{picker.retry}</Text>
                </Pressable>
            </View>
        </ScrollView>
    );
};
