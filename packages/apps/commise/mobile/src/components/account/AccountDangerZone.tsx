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
 *
 * Both triggers are the design-system {@link Button}: `secondary` for the recoverable closure, `destructive`
 * for the irreversible erasure — so they inherit the DS palette, the 44pt touch floor, and the real busy
 * spinner instead of the hand-rolled `Pressable`s (off-palette hex, ~38pt targets, label-swap-only "busy")
 * this surface used to carry as the app's last un-migrated native control.
 */
import { useAuth } from '@clerk/expo';
import { useMessages } from '@commise/i18n/react';
import { selectDonatableRecipes } from '@commise/features-account';
import { AccountEraseDialog, accountDangerMessages } from '@commise/features-account/danger';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { nativeTokens } from '@commise/ui/native';
import { Feather } from '@expo/vector-icons';
import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDeleteAccount } from '../../hooks/useUserProfile.js';

/** Trigger glyph size — the DS Button pairs every label with an icon. */
const TRIGGER_ICON_SIZE = 16;

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
            {/* Recoverable closure — the calmer bordered tier, so it never competes with the erasure. Its
                `busy` state is the DS spinner (the control is disabled while in flight, so an in-progress
                closure cannot be double-fired) AND the localized busy label. */}
            <Button
                variant="secondary"
                icon={<Feather name="user-x" size={TRIGGER_ICON_SIZE} color={palette.charcoal} />}
                busy={deleteAccount.isPending}
                onPress={() => setCloseOpen(true)}
            >
                {deleteAccount.isPending ? close.busyLabel : close.trigger}
            </Button>

            {/* Irreversible erasure — the destructive tier. It opens the phrase-gated dialog; the erasure's
                own in-flight state belongs to that dialog's confirm control, not to this trigger. */}
            <Button
                variant="destructive"
                icon={<Feather name="trash-2" size={TRIGGER_ICON_SIZE} color={palette.error} />}
                onPress={() => setEraseOpen(true)}
            >
                {erase.trigger}
            </Button>

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
    // Spacing from the shared scale — the buttons own their own surface, padding, and touch floor.
    container: { gap: nativeTokens.spacing[3], marginTop: nativeTokens.spacing[5] },
});
