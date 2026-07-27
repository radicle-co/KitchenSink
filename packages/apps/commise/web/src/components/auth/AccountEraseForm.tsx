'use client';

/**
 * @module auth/AccountEraseForm — the account ERASURE control + orchestration (web; CR-002 / U4b).
 *
 * ERASURE is the IRREVERSIBLE action: `POST /v1/account/erasure` permanently destroys the account and its
 * personal data. Distinct from CLOSURE ({@link import('./AccountCloseForm.js').AccountCloseForm}). This is
 * the orchestrational half of the orchestration/render split: it owns the recipe fetch (the donate-election
 * source), the erasure mutation ("Command"), and the ephemeral form state, and hands them to the pure,
 * cross-platform `AccountEraseDialog` (`@commise/features-account/danger`) which owns the render + the phrase
 * gate. The recipe fetch is deferred until the flow opens — a settings-page viewer who never erases pays for
 * no recipe list.
 *
 * The confirmation phrase sent is the viewer's typed input (guaranteed by the dialog's gate to satisfy
 * `confirmsErasurePhrase`); the server re-validates it. `publishRecipeIds` carries the donate election.
 *
 * **Leaving the app after erasure is a FULL-DOCUMENT navigation, deliberately.** `signOut({ redirectUrl })`
 * leaves via the Next router, which re-renders the authenticated shell from a client-side payload that was
 * resolved for a session — and an account — that no longer exists; observed end-to-end, the viewer was left
 * sitting on the authenticated Home route after erasing. So this flow awaits `signOut()` (session cookies
 * gone) and then hard-navigates to the app's public entry, where the root route's own auth gate sends a
 * signed-out caller to the branded welcome hero. Nothing authenticated survives an irreversible erasure.
 *
 * **That exit has its own failure path (B17).** It used to be fire-and-forget, so a `signOut`/navigate failure
 * AFTER the server had already accepted the erasure was swallowed: the viewer sat on an authenticated account
 * page for an account that no longer exists, with no feedback and no idea whether the erasure had happened.
 * Now the flow reports that failure upward, the (dead) dialog is dismissed so it cannot trap focus away from
 * the message, and the surface renders a distinct alert plus the ordinary {@link LogoutButton} as the recovery.
 * The copy is deliberately NOT the dialog's `submitError` — the erasure DID succeed, so inviting a retry of it
 * would be a lie; the only outstanding action is leaving the session.
 */
import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { selectDonatableRecipes } from '@commise/features-account';
import { AccountEraseDialog, accountDangerMessages } from '@commise/features-account/danger';
import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';

import { TrashIcon } from '@/components/auth/icons';
import { authMessages } from '@/components/auth/messages';
import { errorText } from '@/components/auth/authChrome';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { withBasePath } from '@/lib/basePath';
import { navigateTo } from '@/lib/navigation';

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
    const { signOut } = useClerk();
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

    /**
     * End the session, then leave the app with a full document load (see the module doc). Reports a failure
     * upward instead of swallowing it — by this point the erasure has already been accepted, so a silent
     * failure strands the viewer on a dead account page.
     *
     * @sideEffect Destroys the Clerk session and replaces the current document.
     */
    const leaveSignedOut = async (): Promise<void> => {
        try {
            await signOut();
            navigateTo(withBasePath('/'));
        } catch {
            onExitFailed();
        }
    };

    const handleConfirm = () => {
        erasure.mutate(
            { confirmationPhrase: phrase, publishRecipeIds: selectedRecipeIds },
            { onSuccess: () => void leaveSignedOut() },
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
            <Button variant="destructive" icon={<TrashIcon />} onPress={() => setOpen(true)}>
                {erase.trigger}
            </Button>
            {open && <AccountEraseFlow onClose={() => setOpen(false)} onExitFailed={handleExitFailed} />}
            {exitFailed && (
                <>
                    <p role="alert" className={errorText}>
                        {session.eraseSignOutFailed}
                    </p>
                    <LogoutButton />
                </>
            )}
        </>
    );
}
