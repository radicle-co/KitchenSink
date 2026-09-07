/**
 * @module @commise/features-recipes — WEB recipe-source (provenance) line.
 *
 * Pattern: **pure presentational (render) component** — `props → JSX`, one responsibility (say where this
 * recipe came from), no state, no fetching, no ref, and on this platform no side effect at all: the browser's
 * own `<a href>` IS the link adapter, so nothing is injected.
 *
 * It renders for EVERY viewer. Provenance is a property of the recipe, not of who is looking — which is the
 * defect this component exists to close: attribution used to reach the screen only through
 * `RecipeCloneAction`, mounted only for a viewer who could clone, so the OWNER of an imported recipe could
 * never see where it came from and `sourceUrl` reached nobody.
 *
 * SAFETY: `sourceUrl` is untrusted (an import pipeline wrote it, and the wire's `z.string().url()` happily
 * admits `javascript:`/`data:` — see `safeHttpUrl`). Two rules follow, and both are load-bearing:
 *  1. A URL becomes a link ONLY if `safeHttpUrl` admits it; a rejected URL is dropped entirely and never
 *     shown as raw text either.
 *  2. The LINK's visible text is the verified HOST, never `sourceAttribution`. Attribution is untrusted free
 *     text: a recipe claiming "Serious Eats" while pointing at `evil.example` must not be able to borrow
 *     that name as the label of the thing you click. Attribution renders beside the link, as text.
 */
import { useMessages } from '@commise/i18n/react';
import { safeHttpUrl } from '@kitchensink/recipe-core/external-url';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeSourceLineProps } from './model.js';

export const RecipeSourceLine: FC<RecipeSourceLineProps> = ({ sourceUrl, sourceAttribution }) => {
    const { detail } = useMessages(recipeMessages);
    const safe = sourceUrl === undefined ? null : safeHttpUrl(sourceUrl);
    const attribution = sourceAttribution !== undefined && sourceAttribution.length > 0 ? sourceAttribution : undefined;

    // Nothing to attribute and nothing safe to link: render NOTHING — not an empty label, not a dangling
    // "Source:" row.
    if (safe === null && attribution === undefined) {
        return null;
    }

    return (
        <section aria-label={detail.sourceHeading} className="flex flex-wrap items-baseline gap-2 px-1">
            <span className="text-caption uppercase tracking-wide text-slate">{detail.sourceHeading}</span>
            {/* `min-w-0 break-words`: attribution is unbounded user text (`z.string().min(1)`, no ceiling),
                so it must yield the row's width rather than push the link off the edge. */}
            {attribution !== undefined && (
                <span className="min-w-0 break-words text-body-sm text-charcoal">{attribution}</span>
            )}
            {safe !== null && (
                <a
                    href={safe.href}
                    target="_blank"
                    // `noopener` denies the opened page a `window.opener` handle (reverse tabnabbing);
                    // `noreferrer` withholds the viewer's current URL; `nofollow ugc` refuses to lend this
                    // site's link equity to a URL any user can author.
                    rel="noopener noreferrer nofollow ugc"
                    // Contrast (WCAG AA): `ocean-dark` on the page surface is 6.20:1 — the same split the
                    // rest of the detail applies to seafoam-as-TEXT. Underlined, so the affordance is not
                    // carried by colour alone (SC 1.4.1).
                    className="min-w-0 break-all text-body-sm font-medium text-ocean-dark underline underline-offset-2"
                >
                    {safe.host}
                </a>
            )}
        </section>
    );
};
