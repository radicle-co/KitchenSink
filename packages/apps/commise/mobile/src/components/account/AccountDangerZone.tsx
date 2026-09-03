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
 *
 * **Both exits END THE SESSION, and neither may do so silently (ADR-0009 / B17).** The erasure's exit used to
 * be `{ onSuccess: () => void signOut() }` — a fire-and-forget side effect of the mutation, with nowhere to
 * report a problem: a failure left the viewer sitting on an authenticated danger zone for an account that no
 * longer exists, told nothing. Now it issues the app's one sign-out command and, on failure, dismisses the
 * (dead) dialog and surfaces a distinct alert plus {@link SignOutButton} as the recovery. That copy is
 * deliberately NOT the dialog's `submitError`: the erasure has ALREADY succeeded server-side (202) by then, so
 * inviting a retry of it would be a lie — the only outstanding action is leaving the session. A failed CLOSURE
 * likewise now reports `close.error` instead of stopping with no feedback.
 *
 * @pattern Orchestration half of the orchestration/render split for both danger actions — it owns the recipe fetch
 *     and the close and erasure Commands, and hands each to the shared cross-platform render half.
 */
import { useMessages } from '@commise/i18n/react';
import { selectDonatableRecipes } from '@commise/features-account';
import { AccountEraseDialog, accountDangerMessages } from '@commise/features-account/danger';
import { useEraseAccount } from '../../hooks/useUserProfile.js';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { nativeTokens } from '@commise/ui/native';
import { Feather } from '@expo/vector-icons';
import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSignOutAndVerify } from '../../hooks/useSignOutAndVerify.js';
import { useDeleteAccount } from '../../hooks/useUserProfile.js';
import { mobileMessages } from '../../i18n/messages.js';
import { SignOutButton } from './SignOutButton.js';

/** Trigger glyph size — the DS Button pairs every label with an icon. */
const TRIGGER_ICON_SIZE = 16;

/**
 * The mounted-while-open erasure flow: owns the recipe fetch, the mutation, and the form state.
 *
 * @param props - `onClose`, invoked on any dismissal (Cancel / Escape / backdrop), and `onExitFailed`,
 *   invoked when the erasure was ACCEPTED but the follow-up sign-out failed.
 */
function AccountEraseFlow({
    onClose,
    onExitFailed,
}: {
    readonly onClose: () => void;
    readonly onExitFailed: () => void;
}): JSX.Element {
    const { signOutAndVerify } = useSignOutAndVerify();
    const recipes = useAllOwnerRecipes();
    const erasure = useRequestAccountErasure();

    /**
     * The ACCOUNT-level erasure — the half that was missing on BOTH platforms (plan U2).
     *
     * ⛔ The recipe mutation above erases RECIPES and reaches no other service, so while it was the whole
     * flow, "erase my data" left the identity row, the Clerk account, the avatar object and food's requester
     * rows intact — the viewer could sign straight back in. Identity owns the user and is the only service
     * that can start the cross-service erasure. Mirrors the web `AccountEraseForm` exactly, per the
     * cross-platform rule: a fix to one platform must not silently miss the other.
     */
    const accountErasure = useEraseAccount();
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

    /**
     * End the session once the erasure has been accepted, reporting a failure upward instead of swallowing
     * it — by this point the erasure is already done server-side, so a silent failure strands the viewer on a
     * dead account surface.
     *
     * @sideEffect Destroys the Clerk session.
     */
    const leaveSignedOut = async (): Promise<void> => {
        try {
            await signOutAndVerify();
        } catch {
            onExitFailed();
        }
    };

    const handleConfirm = () => {
        erasure.mutate(
            { confirmationPhrase: phrase, publishRecipeIds: selectedRecipeIds },
            {
                // Only leave once the ACCOUNT erasure is accepted too — signing out after the recipe leg
                // alone is what made the old flow look successful while the account still existed.
                onSuccess: () => {
                    accountErasure.mutate(undefined, { onSuccess: () => void leaveSignedOut() });
                },
            },
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
            submitting={erasure.isPending || accountErasure.isPending}
            submitError={erasure.isError || accountErasure.isError}
            onConfirm={handleConfirm}
            onCancel={onClose}
        />
    );
}

/** The account danger-zone controls (close + erase) for the mobile account surface. */
export function AccountDangerZone(): JSX.Element {
    const { close, erase } = useMessages(accountDangerMessages);
    const { account } = useMessages(mobileMessages);
    const deleteAccount = useDeleteAccount();
    const [closeOpen, setCloseOpen] = useState(false);
    const [eraseOpen, setEraseOpen] = useState(false);
    const [eraseExitFailed, setEraseExitFailed] = useState(false);

    /**
     * The erasure was accepted but the exit failed: dismiss the now-dead dialog (it would otherwise hold the
     * viewer inside a flow whose account no longer exists) and surface the alert + its recovery instead.
     */
    const handleEraseExitFailed = (): void => {
        setEraseOpen(false);
        setEraseExitFailed(true);
    };

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
            {deleteAccount.isError ? (
                <Text role="alert" style={styles.error}>
                    {close.error}
                </Text>
            ) : null}

            {/* Irreversible erasure — the destructive tier. It opens the phrase-gated dialog; the erasure's
                own in-flight state belongs to that dialog's confirm control, not to this trigger. */}
            <Button
                variant="destructive"
                icon={<Feather name="trash-2" size={TRIGGER_ICON_SIZE} color={palette['error-dark']} />}
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

            {eraseOpen && <AccountEraseFlow onClose={() => setEraseOpen(false)} onExitFailed={handleEraseExitFailed} />}

            {/* The erasure SUCCEEDED; only leaving failed. The copy says exactly that, and the recovery is the
                sign-out control — never a prompt to retry an erasure that already happened. */}
            {eraseExitFailed ? (
                <>
                    <Text role="alert" style={styles.error}>
                        {account.eraseSignOutFailed}
                    </Text>
                    <SignOutButton />
                </>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    // Spacing from the shared scale — the buttons own their own surface, padding, and touch floor.
    container: { gap: nativeTokens.spacing[3], marginTop: nativeTokens.spacing[5] },
    error: { fontSize: nativeTokens.fontSize.bodySm, color: palette['error-dark'] },
});
