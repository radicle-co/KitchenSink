import { notFound } from 'next/navigation';

/**
 * Catch-all for any path under `/[locale]` that no route matches (E2, `docs/design/uiOverhaul/evaluateShellAndLists.md`).
 *
 * A segment's `not-found.tsx` renders only for a `notFound()` thrown beneath it — never for an unmatched URL, which
 * Next sends to a root not-found this app cannot have (the root layout is `[locale]/layout.tsx`). So unknown URLs got
 * Next's bare built-in page, with no app styles and no way home. This route matches them and throws, so
 * `[locale]/not-found.tsx` renders inside the locale layout, with the providers it needs. More specific routes,
 * including the optional catch-alls under `sign-in` and `sign-up`, still win.
 *
 * ⚠️ A production server answers these with HTTP 200, not 404: `[locale]/loading.tsx` makes every response under the
 * locale stream, and once a response streams Next cannot change its status, so it injects
 * `<meta name="robots" content="noindex">` instead (Next's documented behaviour for a streamed `notFound()`). A true 404
 * needs this route outside the locale's loading boundary, which means a second root layout; that is recorded as a
 * follow-up, not done here.
 */
export default function UnknownRoute(): never {
    notFound();
}
