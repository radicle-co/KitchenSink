/**
 * @module @commise/features-recipes — native collection recipe-picker frame (the ADD half of T072 / FR-009).
 *
 * The React Native frame of `CollectionRecipePicker` — the same controlled, presentational contract: heading, Done
 * and the search field, fetching nothing, mounted around the body the composing app's read boundary renders (the
 * settled candidates, or the loading or load-error body). So Done — the screen's only way out — is reachable in every
 * state, and the search field keeps what was typed.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { TextInput } from '@commise/ui/text-input';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { styles } from './collectionRecipePickerStyles.native.js';
import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerProps } from './model.js';

/** The presentational picker frame: heading, Done and search, around the body the composing app renders. */
export const CollectionRecipePicker: FC<CollectionRecipePickerProps> = ({
    collectionName,
    query,
    onQueryChange,
    onDone,
    children,
}) => {
    const { picker } = useMessages(collectionMessages);
    const heading = fillTemplate(picker.heading, { name: collectionName });

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {heading}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={picker.done}
                    onPress={onDone}
                    style={styles.textButton}
                >
                    <Text style={styles.linkLabel}>{picker.done}</Text>
                </Pressable>
            </View>

            <TextInput
                accessibilityLabel={picker.searchLabel}
                placeholder={picker.searchPlaceholder}
                // Placeholder text is TEXT, so it takes `slate`, never the `mist` hairline tone — see the
                // palette JSDoc in `@commise/ui`'s `tokens/colors.ts`.
                placeholderTextColor={palette.slate}
                value={query}
                onChangeText={onQueryChange}
                style={styles.input}
            />

            {children}
        </View>
    );
};
