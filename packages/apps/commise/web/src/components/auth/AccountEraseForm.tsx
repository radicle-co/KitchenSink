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
 */
import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { useMessages } from '@commise/i18n/react';
import { selectDonatableRecipes } from '@commise/features-account';
import { AccountEraseDialog, accountDangerMessages } from '@commise/features-account/danger';
import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';

/**
 * The mounted-while-open erasure flow: owns the recipe fetch, the mutation, and the form state. Mounted only
 * when the flow is open (so the recipe fetch fires on demand), and always renders the dialog as `open`.
 *
 * @param props - `onClose`, invoked on any dismissal (Cancel / Escape / backdrop).
 */
function AccountEraseFlow({ onClose }: { readonly onClose: () => void }) {
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

    const handleConfirm = () => {
        erasure.mutate(
            { confirmationPhrase: phrase, publishRecipeIds: selectedRecipeIds },
            { onSuccess: () => void signOut({ redirectUrl: '/' }) },
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
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                {erase.trigger}
            </button>
            {open && <AccountEraseFlow onClose={() => setOpen(false)} />}
        </>
    );
}
