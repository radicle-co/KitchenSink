/**
 * @module @commise/features-recipes — native recipe delete-confirmation dialog (T068 building block).
 *
 * The React Native leaf of {@link import('./RecipeDeleteDialog.js').RecipeDeleteDialog} — same controlled,
 * presentational contract: renders nothing while closed; when open it is an `alert`-role surface that names
 * the recipe and offers cancel/confirm, with the confirm action disabled and marked busy while `deleting`.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeDeleteDialogProps } from './model.js';

export const RecipeDeleteDialog: FC<RecipeDeleteDialogProps> = ({
    recipeTitle,
    open,
    deleting = false,
    onConfirm,
    onCancel,
}) => {
    const { deleteDialog } = useMessages(recipeActionMessages);

    if (!open) {
        return null;
    }

    return (
        <View accessibilityRole="alert" accessibilityLabel={deleteDialog.title}>
            <Text accessibilityRole="header">{deleteDialog.title}</Text>
            <Text>{fillTemplate(deleteDialog.body, { title: recipeTitle })}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={deleteDialog.cancel} onPress={onCancel}>
                <Text>{deleteDialog.cancel}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={deleteDialog.confirm}
                aria-busy={deleting || undefined}
                disabled={deleting}
                onPress={onConfirm}
            >
                <Text>{deleteDialog.confirm}</Text>
            </Pressable>
            {deleting && <Text>{deleteDialog.deletingLabel}</Text>}
        </View>
    );
};
