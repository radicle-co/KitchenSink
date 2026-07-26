/**
 * @module components/account/AccountDangerZone — the mobile account danger-zone (CR-002 / U4b).
 *
 * Presents the two DISTINCT, non-conflatable account actions the platform rule requires on BOTH platforms:
 *   - CLOSE ACCOUNT — recoverable (identity ban + tombstone; data retained). Confirmed through the
 *     design-system `ConfirmDialog` with the recoverable `close` copy, then `deleteMe` + sign-out via the
 *     shared `useDeleteAccount` hook.
 *   - ERASE MY DATA — irreversible (GDPR erasure). Driven through the SAME cross-platform, phrase-gated,
 *     donate-election `AccountEraseDialog` the web app uses (`@commise/features-account/danger`); this is the
 *     orchestrational half (recipe fetch + erasure mutation + form state), the dialog is the render half.
 *
 * The mobile counterpart of the web `AccountCloseForm` + `AccountEraseForm`. All copy is localized
 * (`accountDangerMessages`), never hard-coded.
 */
import { useAuth } from '@clerk/expo';
import { useMessages } from '@commise/i18n/react';
import { selectDonatableRecipes } from '@commise/features-account';
import { AccountEraseDialog, accountDangerMessages } from '@commise/features-account/danger';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useDeleteAccount } from '../../hooks/useUserProfile.js';

/** The mounted-while-open erasure flow: owns the recipe fetch, the mutation, and the form state. */
function AccountEraseFlow({ onClose }: { readonly onClose: () => void }): JSX.Element {
    const { signOut } = useAuth();
    const recipes = useAllOwnerRecipes();
    const erasure = useRequestAccountErasure();
    const [phrase, setPhrase] = useState('');
    const [selectedRecipeIds, setSelectedRecipeIds] = useState<readonly string[]>([]);

    const donatableRecipes = selectDonatableRecipes(recipes.recipes).map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
    }));

    const toggleRecipe = (recipeId: string) => {
        setSelectedRecipeIds((current) =>
            current.includes(recipeId) ? current.filter((id) => id !== recipeId) : [...current, recipeId],
        );
    };

    const handleConfirm = () => {
        erasure.mutate(
            { confirmationPhrase: phrase, publishRecipeIds: selectedRecipeIds },
            { onSuccess: () => void signOut() },
        );
    };

    return (
        <AccountEraseDialog
            open
            donatableRecipes={donatableRecipes}
            recipesLoading={recipes.isLoading}
            recipesError={recipes.isError}
            selectedRecipeIds={selectedRecipeIds}
            onToggleRecipe={toggleRecipe}
            phrase={phrase}
            onPhraseChange={setPhrase}
            submitting={erasure.isPending}
            submitError={erasure.isError}
            onConfirm={handleConfirm}
            onCancel={onClose}
        />
    );
}

/** The account danger-zone controls (close + erase) for the mobile account surface. */
export function AccountDangerZone(): JSX.Element {
    const { close, erase } = useMessages(accountDangerMessages);
    const deleteAccount = useDeleteAccount();
    const [closeOpen, setCloseOpen] = useState(false);
    const [eraseOpen, setEraseOpen] = useState(false);

    return (
        <View style={styles.container}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={close.trigger}
                accessibilityState={{ busy: deleteAccount.isPending, disabled: deleteAccount.isPending }}
                disabled={deleteAccount.isPending}
                onPress={() => setCloseOpen(true)}
                style={styles.closeButton}
            >
                <Text style={styles.closeLabel}>{deleteAccount.isPending ? close.busyLabel : close.trigger}</Text>
            </Pressable>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={erase.trigger}
                onPress={() => setEraseOpen(true)}
                style={styles.eraseButton}
            >
                <Text style={styles.eraseLabel}>{erase.trigger}</Text>
            </Pressable>

            <ConfirmDialog
                open={closeOpen}
                title={close.title}
                description={close.description}
                confirmLabel={close.confirm}
                cancelLabel={close.cancel}
                destructive
                onConfirm={() => {
                    setCloseOpen(false);
                    deleteAccount.mutate();
                }}
                onCancel={() => setCloseOpen(false)}
            />

            {eraseOpen && <AccountEraseFlow onClose={() => setEraseOpen(false)} />}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { gap: 12, marginTop: 24 },
    closeButton: {
        borderWidth: 1,
        borderColor: '#B2BEC3',
        borderRadius: 999,
        paddingVertical: 10,
        alignItems: 'center',
    },
    closeLabel: { color: '#2C3E50', fontWeight: '600', fontSize: 15 },
    eraseButton: { backgroundColor: '#E74C3C', borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
    eraseLabel: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
});
