/**
 * @module @commise/features-core/config/supportLink — the address a cook opens to ask Commise to change a locked source
 * (ADR-0100). Each app reads its own optional support address from its env module and hands it to the screen; this builds the
 * link from it.
 */

/**
 * The support link for one recipe.
 *
 * The recipe id is not a secret, and the support page is the trust boundary that receives it. Only an https address makes a
 * link: an unset, malformed or other-scheme value gives none, and the screen draws no link (it never ships a dead one).
 *
 * @param address - The configured support address, or `undefined` when none is set.
 * @param recipeId - The recipe the cook asks about.
 * @returns The link, or `undefined` for no usable address. Pure.
 */
export function supportLinkOf(address: string | undefined, recipeId: string): string | undefined {
    if (address === undefined || !URL.canParse(address)) {
        return undefined;
    }

    const url = new URL(address);

    if (url.protocol !== 'https:') {
        return undefined;
    }

    url.searchParams.set('recipe', recipeId);

    return url.toString();
}
