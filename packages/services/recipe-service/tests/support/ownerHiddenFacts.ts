/**
 * The mocked tier's default answer for `RecipesDal.findOwnerHiddenFacts`: nothing holds the recipe. A suite that seeds a held
 * recipe an owner then reads must NOT use it: its double derives both facts from what it seeded, or the owner's view would say
 * a held recipe is not hidden and the suite would still pass.
 */
export async function noOwnerHiddenFacts(): Promise<{ heldFromReaders: false; hasCookSourceEvidence: false }> {
    return { heldFromReaders: false, hasCookSourceEvidence: false };
}
