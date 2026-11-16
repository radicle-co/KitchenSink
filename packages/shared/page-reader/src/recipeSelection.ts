/**
 * Which recipe a page is about, when its structured data holds more than one.
 *
 * DESIGN PATTERN: **Specification** over the candidates. It owns "which one" and nothing else: it knows candidates and the
 * page's own addresses, never the gate's thresholds or the DOM. Candidates are counted BEFORE the gate (rule 4): picking
 * "the only one that passes" would choose the wrong recipe on a roundup page and call it a yes.
 *
 * 1. The same recipe written twice counts once: by the strategy's key (`@id`, `url`, name), and here also by content (the
 *    same title, ingredient lines and steps, with case and spacing folded).
 * 2. One left: it is the answer.
 * 3. More than one left: the answer is the one whose own address (`url`, `mainEntityOfPage`) is the page's canonical or
 *    `og:url` address. None, or two or more, is `several`: the page is about no single recipe.
 * 4. (the order above) the count is taken before any recipe is judged.
 *
 * Cost is linear in the page's candidates, which `MAX_RECIPES_PER_PAGE` bounds; the page's addresses are read once by the
 * caller, never per candidate.
 */
import { sourceLinksOf } from './detectPageSource.js';
import type { PageAddresses } from './detectPageSource.js';
import type { PageCandidate } from './pageRecipeCandidate.js';

/** The pick. */
export type Selection = { readonly kind: 'one'; readonly candidate: PageCandidate } | { readonly kind: 'several' };

/** An address without its fragment, so a link to the page's comments is the page. */
function withoutFragment(url: string): string {
    const hash = url.indexOf('#');

    return hash === -1 ? url : url.slice(0, hash);
}

/** Case and whitespace folded, so two writings of one line compare equal. Also the gate's G7. */
export function folded(text: string): string {
    return text.trim().split(/\s+/u).join(' ').toLowerCase();
}

/** What makes two candidates one recipe: the title, the ingredient lines and the steps. */
function contentKeyOf(candidate: PageCandidate): string {
    const { title, ingredientLines, steps } = candidate.recipe;

    return JSON.stringify([folded(title), ingredientLines.map(folded), steps.map((step) => folded(step.instruction))]);
}

/**
 * Pick the recipe a page is about.
 *
 * @param candidates - Every recipe the first strategy that found any read, in page order.
 * @param addresses - What the page states for itself, read once.
 * @returns `one` with the candidate, or `several` when no single recipe can be named (including no candidates). Pure.
 */
export function selectCandidate(candidates: readonly PageCandidate[], addresses: PageAddresses): Selection {
    const seen = new Set<string>();
    const distinct = candidates.filter((candidate) => {
        const key = contentKeyOf(candidate);

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
    const [first, ...others] = distinct;

    if (first === undefined) {
        return { kind: 'several' };
    }

    if (others.length === 0) {
        return { kind: 'one', candidate: first };
    }

    // A relative address is read against the base href, else the page's own address.
    const readAgainst: PageAddresses = {
        ...addresses,
        baseHref: addresses.baseHref ?? addresses.canonical ?? addresses.ogUrl,
    };
    const own = new Set(
        sourceLinksOf(
            readAgainst,
            [addresses.canonical, addresses.ogUrl].flatMap((raw) => (raw === undefined ? [] : [raw])),
        ).map((link) => withoutFragment(link.url)),
    );
    const named = distinct.filter((candidate) =>
        sourceLinksOf(readAgainst, candidate.links).some((link) => own.has(withoutFragment(link.url))),
    );
    const [only] = named;

    return named.length === 1 && only !== undefined ? { kind: 'one', candidate: only } : { kind: 'several' };
}
