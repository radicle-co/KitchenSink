/**
 * @module @commise/features-account/danger/AccountEraseDialog.native — the NATIVE account-erasure dialog
 * (CR-002 / U4b). The React Native leaf of `AccountEraseDialog` — the
 * SAME controlled, presentational contract, phrase gate, and donate election as the web leaf, so the two
 * platforms can never drift on behaviour or on which inputs enable the destructive confirm.
 *
 * Renders nothing while `open` is false — an explicit early return (not `Modal`'s `visible` prop): under
 * `react-native-web` a `Modal` keeps its portal content mounted across a `visible` toggle, so gating the
 * whole `<Modal>` behind `open` keeps this leaf's contract identical to every other controlled dialog here
 * (mirrors `@commise/ui`'s `ConfirmDialog.native`).
 *
 * @pattern Adapter over React Native's `Modal` around the same `confirmsErasurePhrase` Specification, so the phrase
 *     gate is one rule rather than one per platform.
 * @pattern The `recipesLoading` / `recipesError` booleans are DISPLAY DERIVATION of one donate-election slot, exactly
 *     as on web — same dialog, same gate, same actions in every branch.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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

    if (!open) {
        return null;
    }

    const canConfirm = confirmsErasurePhrase(phrase) && !submitting;
    const selected = new Set(selectedRecipeIds);

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
            <View style={styles.backdrop}>
                <View accessibilityViewIsModal accessibilityLabel={erase.title} style={styles.card}>
                    <ScrollView contentContainerStyle={styles.content}>
                        <Text accessibilityRole="header" style={styles.title}>
                            {erase.title}
                        </Text>
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
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(44, 62, 80, 0.4)',
        padding: 16,
    },
    card: {
        width: '100%',
        maxWidth: 480,
        maxHeight: '85%',
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
    },
    content: { padding: 20, gap: 12 },
    title: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
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
