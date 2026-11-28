/**
 * The mocked tier's default answer for `RecipesDal.findOwnerHiddenFacts`: nothing holds the recipe. A suite that seeds a held
 * recipe an owner then reads must NOT use it: its double derives both facts from what it seeded, or the owner's view would say
 * a held recipe is not hidden and the suite would still pass.
 */
export function noOwnerHiddenFacts(): Promise<{ ownerHeldFromReaders: false; hasCookSourceEvidence: false }> {
    return Promise.resolve({ ownerHeldFromReaders: false, hasCookSourceEvidence: false });
}
