/**
 * The New recipe press token. Pressing the sidebar's New recipe while the new-recipe page is already open is a
 * search-param-only navigation, and Next keeps a page's state across one — so the editor kept the draft in front of the
 * cook and the press looked dead. Every press therefore opens the route with a token that is new for that press
 * (`?fresh=<token>`), and the editor container keys its new-recipe subtree on it.
 *
 * ⛔ The key is this token and NEVER `?draft=`: the editor writes `?draft=` itself as the recipe gets a ref and a server
 * id, and a key on that would remount the editor in the middle of the cook's typing. The editor's own URL follow keeps
 * the token ({@link withDraftRef}) for the same reason.
 */

/** The query parameter that carries the token. */
const FRESH_PARAM = 'fresh';

/** The query parameter the editor names its recipe's ref in. */
const DRAFT_PARAM = 'draft';

/**
 * The address a New recipe press opens.
 *
 * @param locale - The route locale.
 * @param token - A value no earlier press used.
 * @returns The path. Pure.
 */
export function freshRecipeHref(locale: string, token: string): string {
    return `/${locale}/recipes/new?${new URLSearchParams({ [FRESH_PARAM]: token }).toString()}`;
}

/**
 * A token for one press.
 *
 * @returns A value no earlier press used.
 * @sideEffect Draws from the platform's random source.
 */
export function mintFreshToken(): string {
    return crypto.randomUUID();
}

/**
 * The press token an editor's search parameters carry.
 *
 * @param params - The page's search parameters.
 * @returns The token, or `undefined` when the editor was not opened by a press (or the value is empty). Pure.
 */
export function freshTokenOf(params: Pick<URLSearchParams, 'get'>): string | undefined {
    const token = params.get(FRESH_PARAM);

    return token === null || token === '' ? undefined : token;
}

/**
 * The query the editor follows its recipe with: the draft ref and the press token. Nothing else is carried — the paste
 * flag, for one, is a request to open the sheet once and must not come back on a reload.
 *
 * @param search - The current `location.search`.
 * @param ref - The recipe's local ref or server id.
 * @returns A query string starting with `?`. Pure.
 */
export function withDraftRef(search: string, ref: string): string {
    const token = freshTokenOf(new URLSearchParams(search));
    const params = new URLSearchParams(token === undefined ? {} : { [FRESH_PARAM]: token });

    params.set(DRAFT_PARAM, ref);

    return `?${params.toString()}`;
}
