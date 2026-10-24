/**
 * The page for every URL no route matches (E2, `docs/design/uiOverhaul/evaluateShellAndLists.md`): the app's own 404,
 * in the app's document, answered with a real `404` and server-rendered. Enabled by `experimental.globalNotFound` in
 * `next.config.ts`.
 *
 * ⛔ Why this file, and not a `[locale]/[...rest]` catch-all that calls `notFound()` (which slice 0 shipped). That
 * catch-all could not do both halves of the job:
 *  - Under `[locale]/loading.tsx` the response streams, and a streamed response has already sent its 200. Next then
 *    answers `notFound()` with a `noindex` tag and the loading skeleton (`loading.js` → "Status Codes").
 *  - Without a loading boundary above it the status became 404, but Next 16.3 renders a `notFound()` that reaches the
 *    top of the server render as an EMPTY error document (`<html id="__next_error__">`), and the 404 UI appears only
 *    after hydration. Measured with `next start`; the code path is `renderToStream`'s error recovery in
 *    `next/dist/server/app-render/app-render.js`.
 * Next documents this file for exactly this app's shape: "Your root layout is defined using top-level dynamic segments
 * (e.g. `app/[country]/layout.tsx`)" (`not-found.js` → `global-not-found.js`). Next "skips rendering and directly
 * returns this global page", so the status is 404 and the HTML is the page itself.
 *
 * It bypasses every layout, so it renders {@link appDocument} itself — the same document and providers as every route.
 * It has no route params, so the locale is the default one ({@link DEFAULT_LOCALE}); only `en` ships today. A
 * `notFound()` thrown by a page (a missing recipe) is a different path: it still renders `[locale]/not-found.tsx`.
 *
 * ⛔ No `auth()`, `headers()` or cookies here: the page is rendered once, at build time. {@link NotFoundSurface} reads
 * the session on the client, so a signed-in viewer gets the app shell after hydration.
 */
import type { Metadata } from 'next';

import { appDocument } from '@/app/appDocument';
import { NotFoundSurface } from '@/components/app/NotFoundSurface';
import { getDictionary } from '@/i18n/getDictionary';
import { DEFAULT_LOCALE } from '@/lib/i18n';

export const metadata: Metadata = { title: getDictionary(DEFAULT_LOCALE).boundary.notFound.title };

export default function GlobalNotFound(): React.JSX.Element {
    return appDocument({ locale: DEFAULT_LOCALE, children: <NotFoundSurface /> });
}
