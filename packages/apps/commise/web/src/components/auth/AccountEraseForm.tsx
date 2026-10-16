'use client';

/**
 * @module auth/AccountEraseForm — the account ERASURE control + orchestration (web; CR-002 / U4b).
 *
 * ERASURE is the IRREVERSIBLE action: `POST /api/v1/account/erasure` permanently destroys the account and its
 * personal data. Distinct from CLOSURE (`AccountCloseForm`). This is
 * the orchestrational half of the orchestration/render split: it owns the recipe fetch (the donate-election
 * source), the erasure mutation ("Command"), and the ephemeral form state, and hands them to the pure,
 * cross-platform `AccountEraseDialog` (`@commise/features-account/danger`) which owns the render + the phrase
 * gate. The recipe fetch is deferred until the flow opens — a settings-page viewer who never erases pays for
 * no recipe list.
 *
 * The confirmation phrase sent is the viewer's typed input (guaranteed by the dialog's gate to satisfy
 * `confirmsErasurePhrase`); the server re-validates it. `publishRecipeIds` carries the donate election.
 *
 * Leaving the app after erasure goes through the app's one sign-out command,
 * `useSignOutAndLeave`. `signOut({ redirectUrl })` leaves via the
 * Next router, which re-renders the authenticated shell from a client-side payload that was resolved for a
 * session — and an account — that no longer exists; observed end-to-end, the viewer was left sitting on the
 * authenticated Home route after erasing. So the command awaits the revoke (session cookies gone) and then
 * hard-navigates to the app's public entry, where the locale root's own auth gate sends a signed-out caller to
 * the sign-in form. Nothing authenticated survives an irreversible erasure. The command also VERIFIES
 * the session actually ended before navigating (B23: a sign-out issued before clerk-js has loaded resolves
 * without revoking anything), so a fake exit lands in the failure path below instead of looking like success.
 *
 * **That exit has its own failure path (B17).** It used to be fire-and-forget, so a `signOut`/navigate failure
 * AFTER the server had already accepted the erasure was swallowed: the viewer sat on an authenticated account
 * page for an account that no longer exists, with no feedback and no idea whether the erasure had happened.
 * Now the flow reports that failure upward, the (dead) dialog is dismissed so it cannot trap focus away from
 * the message, and the surface renders a distinct alert plus the ordinary {@link LogoutButton} as the recovery.
 * The copy is deliberately NOT the dialog's `submitError` — the erasure DID succeed, so inviting a retry of it
 * would be a lie; the only outstanding action is leaving the session.
 *
 * @pattern Orchestration half of the orchestration/render split — it owns the deferred recipe fetch and the erasure
 *     Command, and hands both to the pure cross-platform `AccountEraseDialog`, which owns the phrase gate.
 */
import { useState } from 'react';
import { useMessages } from '@commise/i18n/react';
import { ProfileRow } from '@commise/features-account/profile';
import { isErasureStepError, selectDonatableRecipes, useErasureSequence } from '@commise/features-account';
import { AccountEraseDialog, accountDangerMessages } from '@commise/features-account/danger';
import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';

import { authMessages } from '@/components/auth/messages';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { useSignOutAndLeave } from '@/components/auth/useSignOutAndLeave';
import { useEraseAccount } from '@/components/auth/useEraseAccount';

/**
 * The mounted-while-open erasure flow: owns the recipe fetch, the mutation, and the form state. Mounted only
 * when the flow is open (so the recipe fetch fires on demand), and always renders the dialog as `open`.
 *
 * @param props - `onClose`, invoked on any dismissal (Cancel / Escape / backdrop), and `onExitFailed`,
 *   invoked when the erasure was ACCEPTED but the follow-up sign-out / navigation failed.
 */
function AccountEraseFlow({
    onClose,
    onExitFailed,
}: {
    readonly onClose: () => void;
    readonly onExitFailed: () => void;
}) {
    const { signOutAndLeave } = useSignOutAndLeave();
    const recipes = useAllOwnerRecipes();
    const erasure = useRequestAccountErasure();

    /**
     * The ACCOUNT-level erasure — the second half of the flow, and the half that was missing. The recipe
     * mutation above erases RECIPES and reaches no other service; this is what erases the identity row,
     * deletes the Clerk account and fans the erasure out to food. See `useEraseAccount`.
     */
    const accountErasure = useEraseAccount();

    /**
     * Recipes → account → sign-out as ONE mutation (`useErasureSequence`, `@commise/features-account`), so the
     * sequence finishes even if this flow unmounts mid-way (browser Back, a route change): the chained
     * `onSuccess` callbacks it replaces were dropped on unmount, leaving recipes erased and the account and
     * session alive. `isPending` stays true through the sign-out, so the flow is busy until the viewer has left.
     * The sign-out step is `signOutAndLeave`, which keeps ADR-0009's verified post-condition.
     */
    const sequence = useErasureSequence({
        eraseRecipes: erasure.mutateAsync,
        eraseAccount: accountErasure.mutateAsync,
        leave: signOutAndLeave,
    });

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
        sequence.mutate(
            { confirmationPhrase: phrase, publishRecipeIds: selectedRecipeIds },
            {
                // The erasure was ACCEPTED and only leaving failed (B17): report it upward instead of swallowing
                // it, because a silent failure strands the viewer on a dead account page. A failed recipe or
                // account step is the dialog's own `submitError` below. (An observer callback: if the flow has
                // unmounted there is no surface left to report to; the sequence itself is unaffected.)
                onError: (error) => {
                    if (isErasureStepError(error, 'exit')) {
                        onExitFailed();
                    }
                },
            },
        );
    };

    return (
        <AccountEraseDialog
            open
            donatableRecipes={donatableRecipes}
            recipesLoading={recipes.isLoading}
            // ⛔ `isError` DELIBERATELY, not a loading error: a failed refresh blocks the donate election rather than
            // offering a list that may be stale, because erasure destroys every recipe the viewer is not shown.
            recipesError={recipes.isError}
            selectedRecipeIds={selectedRecipeIds}
            onToggleRecipe={toggleRecipe}
            phrase={phrase}
            onPhraseChange={setPhrase}
            submitting={sequence.isPending}
            // A failed EXIT is not a submit error — the erasure succeeded; it has its own alert (see `onExitFailed`).
            submitError={isErasureStepError(sequence.error, 'recipes') || isErasureStepError(sequence.error, 'account')}
            onConfirm={handleConfirm}
            onCancel={onClose}
        />
    );
}

export function AccountEraseForm() {
    const { erase } = useMessages(accountDangerMessages);
    const { session } = useMessages(authMessages);
    const [open, setOpen] = useState(false);
    const [exitFailed, setExitFailed] = useState(false);

    /**
     * The erasure was accepted but the exit failed: dismiss the now-dead dialog (Radix would otherwise trap
     * focus inside it, away from the message) and surface the alert + its recovery on the page itself.
     */
    const handleExitFailed = (): void => {
        setOpen(false);
        setExitFailed(true);
    };

    return (
        <>
            <ProfileRow
                label={erase.trigger}
                hint={erase.rowHint}
                tone="danger"
                chevron
                onPress={() => setOpen(true)}
            />
            {open && <AccountEraseFlow onClose={() => setOpen(false)} onExitFailed={handleExitFailed} />}
            {exitFailed && (
                <>
                    <p role="alert" className="px-4 pb-3 text-meta text-danger-text">
                        {session.eraseSignOutFailed}
                    </p>
                    <LogoutButton />
                </>
            )}
        </>
    );
}
