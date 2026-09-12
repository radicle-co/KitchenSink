/**
 * @module @commise/features-account/danger/AccountEraseDialog.native — the NATIVE account-erasure dialog
 * (CR-002 / U4b). The React Native leaf of `AccountEraseDialog` — the
 * SAME controlled, presentational contract, phrase gate, and donate election as the web leaf, so the two
 * platforms can never drift on behaviour or on which inputs enable the destructive confirm.
 *
 * Renders nothing while `open` is false: the frame returns early rather than toggling `Modal`'s `visible`, because
 * under `react-native-web` a `Modal` keeps its portal content mounted across a `visible` toggle.
 *
 * The window, the scrim, the safe area, the keyboard and the card are the design system's `DialogFrame`
 * (`docs/design/compactHeightLayout.md` §9): sideways, the keyboard used to cover the phrase field and both actions,
 * with nothing to move them. Taps persist through the keyboard, so the first tap on Erase presses it.
 *
 * @pattern Adapter over `@commise/ui/dialog-frame` around the same `confirmsErasurePhrase` Specification, so the phrase
 *     gate is one rule rather than one per platform.
 * @pattern The `recipesLoading` / `recipesError` booleans are DISPLAY DERIVATION of one donate-election slot, exactly
 *     as on web — same dialog, same gate, same actions in every branch.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { DialogFrame } from '@commise/ui/dialog-frame';
import { TextInput } from '@commise/ui/text-input';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE, confirmsErasurePhrase } from '../erasure.js';
import { accountDangerMessages } from './messages.js';
import type { AccountEraseDialogProps } from './model.js';

export const AccountEraseDialog: FC<AccountEraseDialogProps> = ({
    open,
    donatableRecipes,
    recipesLoading = false,
    recipesError = false,
    selectedRecipeIds,
    onToggleRecipe,
    phrase,
    onPhraseChange,
    submitting = false,
    submitError = false,
    onConfirm,
    onCancel,
}) => {
    const { erase } = useMessages(accountDangerMessages);
    const canConfirm = confirmsErasurePhrase(phrase) && !submitting;
    const selected = new Set(selectedRecipeIds);

    return (
        <DialogFrame open={open} onRequestClose={onCancel} title={erase.title} role="dialog">
            <Text style={styles.warning}>{erase.warning}</Text>
            <Text style={styles.body}>{erase.distinction}</Text>

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {erase.donateHeading}
            </Text>
            <Text style={styles.body}>{erase.donateHelp}</Text>
            {recipesLoading ? (
                <Text accessibilityRole="text" style={styles.body}>
                    {erase.recipesLoadingLabel}
                </Text>
            ) : recipesError ? (
                <Text style={styles.body}>{erase.recipesError}</Text>
            ) : donatableRecipes.length === 0 ? (
                <Text style={styles.body}>{erase.donateEmpty}</Text>
            ) : (
                donatableRecipes.map((recipe) => {
                    const checked = selected.has(recipe.id);

                    return (
                        <Pressable
                            key={recipe.id}
                            accessibilityRole="checkbox"
                            accessibilityLabel={recipe.title}
                            accessibilityState={{ checked }}
                            aria-checked={checked}
                            onPress={() => onToggleRecipe(recipe.id)}
                            style={styles.recipeRow}
                        >
                            <Text style={styles.checkbox}>{checked ? '☑' : '☐'}</Text>
                            <Text style={styles.recipeTitle}>{recipe.title}</Text>
                        </Pressable>
                    );
                })
            )}

            <Text style={styles.body}>
                {erase.phrasePrompt.replace('{phrase}', ACCOUNT_ERASURE_CONFIRMATION_PHRASE)}
            </Text>
            <TextInput
                accessibilityLabel={erase.phraseLabel}
                value={phrase}
                onChangeText={onPhraseChange}
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.input}
            />

            <View style={styles.actions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={erase.cancel}
                    onPress={onCancel}
                    style={styles.cancelButton}
                >
                    <Text style={styles.cancelLabel}>{erase.cancel}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={erase.confirm}
                    accessibilityState={{ disabled: !canConfirm, busy: submitting }}
                    aria-busy={submitting || undefined}
                    disabled={!canConfirm}
                    onPress={onConfirm}
                    style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
                >
                    <Text style={styles.confirmLabel}>{erase.confirm}</Text>
                </Pressable>
            </View>

            {submitting && <Text style={styles.body}>{erase.busyLabel}</Text>}
            {submitError && !submitting && <Text style={styles.error}>{erase.error}</Text>}
        </DialogFrame>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    sectionHeading: { fontSize: 16, fontWeight: '600', color: palette.charcoal, marginTop: 4 },
    warning: { fontSize: 15, lineHeight: 22, color: palette['error-dark'] },
    body: { fontSize: 14, lineHeight: 20, color: palette.slate },
    recipeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    checkbox: { fontSize: 18, color: palette.charcoal },
    recipeTitle: { fontSize: 14, color: palette.charcoal },
    input: {
        borderWidth: 1,
        borderColor: border,
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        fontSize: 15,
        color: palette.charcoal,
    },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 },
    cancelButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    cancelLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    confirmButton: { backgroundColor: palette.error, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 20 },
    confirmButtonDisabled: { opacity: 0.5 },
    confirmLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    error: { fontSize: 13, color: palette['error-dark'] },
});
