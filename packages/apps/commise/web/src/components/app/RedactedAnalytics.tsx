'use client';

/**
 * Vercel Web Analytics, mounted with the URL-redaction interceptor already wired — the ONE sanctioned way
 * this app reports a page view. Nothing else should import `@vercel/analytics` directly: an unwrapped
 * `<Analytics />` ships every page view's full URL, query string included, and `/[locale]/discover` carries
 * the visitor's free-text search term plus their dietary flags (see {@link redactAnalyticsEvent} for the
 * policy and the GDPR Art. 9 reasoning).
 *
 * **Pattern.** An **Adapter** binding seam: it exists solely to bind a policy (the pure interceptor) to a
 * third-party leaf, and is itself a **Null Object** render-wise — it adds no DOM, no landmark, no focusable
 * node. It holds no state and no branch, so there is no orchestration here to test beyond the binding.
 *
 * **Why a wrapper instead of `beforeSend` on the layout's own `<Analytics />`:** `[locale]/layout.tsx` is a
 * SERVER component, and React will not serialize a function prop across the RSC boundary. Writing
 * `<Analytics beforeSend={…} />` there throws `Functions cannot be passed directly to Client Components`
 * and returns **500 on every request** — measured, not assumed, and stated precisely because
 * **`next build` does NOT catch it**: every `[locale]` route bails out of prerendering (the Clerk provider
 * reads request state), so the tree is never flight-serialized at build time and the build stays green
 * while the deployed app is dead. This client boundary is what lets the hook be an ordinary module-level
 * function reference, which also keeps its identity stable (the vendor leaf re-runs its registration effect
 * whenever `beforeSend` changes identity, so an inline arrow would re-register on every render).
 *
 * `beforeSend` runs in the BROWSER, so the module graph reachable from here stays client-safe:
 * {@link redactAnalyticsEvent} is pure, dependency-free apart from the shared text scrubber, and touches no
 * Node or server-only API.
 */
import { Analytics } from '@vercel/analytics/next';
import type { ReactElement } from 'react';

import { redactAnalyticsEvent } from '@/lib/analyticsRedaction';

/**
 * Mount Vercel Web Analytics with `beforeSend` redaction. Renders nothing.
 *
 * @returns The vendor analytics leaf, bound to {@link redactAnalyticsEvent}.
 */
export function RedactedAnalytics(): ReactElement {
    return <Analytics beforeSend={redactAnalyticsEvent} />;
}
