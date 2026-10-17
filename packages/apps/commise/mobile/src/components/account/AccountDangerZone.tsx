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
 * It draws the Profile page's Danger zone group (`buildSpec.md` §9.1): both triggers are the shared
 * {@link ProfileRow} in the `danger` tone, each with its consequence as a hint, as direct children of ONE
 * {@link ProfileGroup} (which draws the hairline between them from its direct children). The dialogs and the alerts
 * sit OUTSIDE the group's card. Colour comes from the theme at render.
 *
 * **Both exits END THE SESSION, and neither may do so silently (ADR-0009 / B17).** The erasure's exit used to
 * be `{ onSuccess: () => void signOut() }` — a fire-and-forget side effect of the mutation, with nowhere to
 * report a problem: a failure left the viewer sitting on an authenticated danger zone for an account that no
 * longer exists, told nothing. Now it issues the app's one sign-out command and, on failure, dismisses the
 * (dead) dialog and surfaces a distinct alert plus {@link SignOutButton} as the recovery. That copy is
 * deliberately NOT the dialog's `submitError`: the erasure has ALREADY succeeded server-side (202) by then, so
 * inviting a retry of it would be a lie — the only outstanding action is leaving the session. A failed CLOSURE
 * likewise reports itself, and says WHICH step failed: `close.error` when the account is still open, but when only the
 * exit failed the row becomes an inert "Account closed" and `close.signOutFailed` plus {@link SignOutButton} take over,
 * never inviting a second close of a closed account. Both alerts are assertive `LiveRegion`s, because React Native's
 * `role="alert"` does not announce on iOS.
 *
 * @pattern Orchestration half of the orchestration/render split for both danger actions — it owns the recipe fetch
 *     and the close and erasure Commands, and hands each to the shared cross-platform render half.
 */
import { useMessages } from '@commise/i18n/react';
import { type ErasureSteps } from '@commise/features-account';
import {
    AccountEraseDialog,
    accountDangerMessages,
    closeConfirmOf,
    closeRowOf,
    useAccountEraseControl,
    useAccountEraseFlow,
    useEraseAccount,
} from '@commise/features-account/danger';
import { useProfileServiceClient } from '../../hooks/useProfileServiceClient.js';
import { ProfileGroup, ProfileRow, profileMessages } from '@commise/features-account/profile';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { isGoneError } from '@kitchensink/recipe-service-client';
import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSignOutAndVerify } from '../../hooks/useSignOutAndVerify.js';
import { useDeleteAccount } from '../../hooks/useDeleteAccount.js';
import { SignOutButton } from './SignOutButton.js';

/**
 * The mounted-while-open erasure flow: owns the recipe fetch and the mobile-bound steps, and hands the rest to the
 * shared `useAccountEraseFlow` (phrase, election, the sequence, which failure the dialog owns).
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
     * that can start the cross-service erasure (it enqueues the message whose worker deletes the Clerk account and fans out to recipe and food).
     */
    const accountErasure = useEraseAccount(useProfileServiceClient());

    /**
     * Recipes -> account -> sign-out, run by the shared flow's `useErasureSequence` (the same sequence web runs), so it
     * finishes even if this screen unmounts mid-way. The last step is `signOutAndVerify`, which keeps ADR-0009's
     * verified post-condition.
     */
    const steps: ErasureSteps = {
        eraseRecipes: erasure.mutateAsync,
        eraseAccount: accountErasure.mutateAsync,
        leave: signOutAndVerify,
        recipesAlreadyErased: isGoneError,
    };

    const flow = useAccountEraseFlow({
        recipes: { recipes: recipes.recipes, isLoading: recipes.isLoading, isError: recipes.isError },
        steps,
        onExitFailed,
        onCancel: onClose,
    });

    return <AccountEraseDialog {...flow} />;
}

/** The account danger-zone controls (close + erase) for the mobile account surface. */
export function AccountDangerZone(): JSX.Element {
    const { close, erase } = useMessages(accountDangerMessages);
    const profile = useMessages(profileMessages);
    const { colors } = useTheme();
    const deleteAccount = useDeleteAccount();
    // The row, its failure kind and the confirmation are decided once for both apps (`closeRowOf`, `closeConfirmOf`).
    // A failed close and a failed exit say different things: the account is still open, or it IS closed.
    const row = closeRowOf(deleteAccount, close);
    const [closeOpen, setCloseOpen] = useState(false);
    // The erasure was accepted but the exit failed: the shared control dismisses the now-dead dialog and shows the
    // alert + its recovery instead.
    const eraseControl = useAccountEraseControl();

    return (
        <View style={styles.container}>
            <ProfileGroup heading={profile.dangerZone}>
                {/* Recoverable closure. Its `busy` state disables the row while in flight, so an in-progress closure
                    cannot be double-fired, and the label says so. */}
                <ProfileRow
                    label={row.label}
                    hint={close.rowHint}
                    tone="danger"
                    chevron={row.chevron}
                    busy={row.busy}
                    inert={row.inert}
                    onPress={() => setCloseOpen(true)}
                />
                {/* Irreversible erasure. It opens the phrase-gated dialog; the erasure's own in-flight state belongs to
                    that dialog's confirm control, not to this row. */}
                <ProfileRow
                    label={erase.trigger}
                    hint={erase.rowHint}
                    tone="danger"
                    chevron
                    onPress={eraseControl.openDialog}
                />
            </ProfileGroup>
            {/* Mounted BEFORE there is anything to say, because Android speaks a CHANGE to a live region it already
                holds. Assertive, because React Native's `role="alert"` does not announce on iOS. */}
            <LiveRegion politeness="assertive" style={[styles.error, { color: colors.dangerText }]}>
                {row.failure === 'exit' ? close.signOutFailed : row.failure === 'close' ? close.error : ''}
            </LiveRegion>
            {row.failure === 'exit' ? (
                <ProfileGroup label={profile.signOut}>
                    <SignOutButton />
                </ProfileGroup>
            ) : null}

            <ConfirmDialog
                {...closeConfirmOf(close)}
                open={closeOpen}
                onConfirm={() => {
                    setCloseOpen(false);
                    deleteAccount.mutate();
                }}
                onKeep={() => setCloseOpen(false)}
            />

            {eraseControl.open && (
                <AccountEraseFlow onClose={eraseControl.closeDialog} onExitFailed={eraseControl.onExitFailed} />
            )}

            {/* The erasure SUCCEEDED; only leaving failed. The copy says exactly that, and the recovery is the
                sign-out control — never a prompt to retry an erasure that already happened. */}
            <LiveRegion politeness="assertive" style={[styles.error, { color: colors.dangerText }]}>
                {eraseControl.exitFailed ? erase.signOutFailed : ''}
            </LiveRegion>
            {eraseControl.exitFailed ? (
                <ProfileGroup label={profile.signOut}>
                    <SignOutButton />
                </ProfileGroup>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[3] },
    error: { ...nativeTokens.type.meta },
});
