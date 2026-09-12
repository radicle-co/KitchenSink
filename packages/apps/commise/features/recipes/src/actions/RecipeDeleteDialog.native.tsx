/**
 * @module @commise/features-recipes — native recipe delete-confirmation dialog (T068 building block).
 *
 * The React Native leaf of `RecipeDeleteDialog` — same controlled,
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
 *
 * The window, the scrim, the safe area, the keyboard, the capped card that scrolls and the title are the design
 * system's `DialogFrame` (`docs/design/compactHeightLayout.md` §9), as an interrupting `alert`.
 *
 * @pattern Adapter over the design-system `DialogFrame` — the platform expression of the web leaf's Radix
 *     `AlertDialog` adapter, with the same controlled `props → JSX` contract.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { DialogFrame } from '@commise/ui/dialog-frame';
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

    return (
        /* ⛔ A MODAL WINDOW, NOT AN INLINE BLOCK — and this is a CORRECTNESS fix, not presentation. As an inline block
           this card rendered wherever it happened to sit in the caller's tree. When the owner actions moved into the
           detail's title band, the trigger went with them and the card stayed the last child of the screen's
           ScrollView — so tapping Delete opened a confirmation BELOW the hero, every ingredient, every step and the
           rating block, i.e. off-screen with no visible response. The web leaf never had this failure because Radix
           portals its `AlertDialog`; that asymmetry is exactly what an inline native "equivalent" hides. */
        <DialogFrame open={open} onRequestClose={onCancel} title={deleteDialog.title} role="alert">
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
        </DialogFrame>
    );
};

const styles = StyleSheet.create({
    body: { fontSize: nativeTokens.fontSize.bodyMd, lineHeight: 22, color: palette.slate },
    // The buttons own their own surface, padding, and touch floor — this row only spaces them.
    actions: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[3] },
    error: { fontSize: 13, color: palette['error-dark'] },
});
