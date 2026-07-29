/**
 * @module @commise/features-recipes — native recipe delete-confirmation dialog (T068 building block).
 *
 * The React Native leaf of {@link import('./RecipeDeleteDialog.js').RecipeDeleteDialog} — same controlled,
 * presentational contract: renders nothing while closed; when open it is an `alert`-role surface that names
 * the recipe and offers cancel/confirm, with the confirm action disabled and marked busy while `deleting`.
 *
 * BOTH actions are the design-system {@link Button}, so they carry the DS palette, the 44pt touch floor, the
 * reduce-motion-safe press scale, and — for confirm — a real in-place `ActivityIndicator` plus the
 * disabled + `accessibilityState.busy` in-flight guard that used to be hand-rolled here as an opacity tweak.
 *
 * Note the web leaf's cancel deliberately is NOT the `Button` component: Radix's `AlertDialog.Cancel` owns its
 * own element (it wires the close behaviour onto it), so web wears the DS surface via the shared class recipe
 * instead. There is no Radix on native — the cancel is an ordinary control — so this leaf uses the real
 * component for both, which is strictly better than mirroring a web-only constraint.
 *
 * Cancel stays ENABLED while a delete is in flight: if the mutation hangs, disabling both actions would trap
 * the viewer in a modal with no way out.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { Feather } from '@expo/vector-icons';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeDeleteDialogProps } from './model.js';

/** Action glyph size — the DS Button pairs every label with an icon. */
const ACTION_ICON_SIZE = 16;

export const RecipeDeleteDialog: FC<RecipeDeleteDialogProps> = ({
    recipeTitle,
    open,
    deleting = false,
    error = false,
    onConfirm,
    onCancel,
}) => {
    const { deleteDialog } = useMessages(recipeActionMessages);

    if (!open) {
        return null;
    }

    return (
        <View accessibilityRole="alert" accessibilityLabel={deleteDialog.title} style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
                {deleteDialog.title}
            </Text>
            <Text style={styles.body}>{fillTemplate(deleteDialog.body, { title: recipeTitle })}</Text>
            <View style={styles.actions}>
                {/* The calmer bordered tier — it must never compete with the destructive action beside it. */}
                <Button
                    variant="secondary"
                    icon={<Feather name="x" size={ACTION_ICON_SIZE} color={palette.charcoal} />}
                    onPress={onCancel}
                >
                    {deleteDialog.cancel}
                </Button>
                {/* `busy` supplies the spinner, the disabled in-flight guard, and the busy announcement. */}
                <Button
                    variant="destructive"
                    icon={<Feather name="trash-2" size={ACTION_ICON_SIZE} color={palette['error-dark']} />}
                    busy={deleting}
                    onPress={onConfirm}
                >
                    {deleteDialog.confirm}
                </Button>
            </View>
            {deleting && <Text style={styles.body}>{deleteDialog.deletingLabel}</Text>}
            {error && !deleting && <Text style={styles.error}>{deleteDialog.error}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        // `lg`, matching every other card surface in this feature — the previous 16 was off the radius scale.
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        padding: nativeTokens.spacing[5],
        gap: nativeTokens.spacing[3],
    },
    title: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    body: { fontSize: nativeTokens.fontSize.bodyMd, lineHeight: 22, color: palette.slate },
    // The buttons own their own surface, padding, and touch floor — this row only spaces them.
    actions: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[3] },
    error: { fontSize: 13, color: palette['error-dark'] },
});
