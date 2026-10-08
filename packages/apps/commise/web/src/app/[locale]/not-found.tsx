/**
 * The not-found boundary for `/[locale]`. It renders for every `notFound()` thrown beneath the locale layout — a page's
 * own, such as a missing recipe. A URL no route matches is answered by `global-not-found.tsx` instead. Both delegate to
 * {@link NotFoundSurface}, which puts the page in the app shell for a signed-in viewer.
 *
 * ⛔ Kept synchronous, with no `auth()`. Next builds this element for EVERY request under `[locale]`, not only on a
 * miss — including `/favicon.ico`, which arrives here as a locale with no `clerkMiddleware()` run, where `auth()`
 * throws (the error `[locale]/page.tsx` records). Who is signed in is read on the client instead.
 */
import { NotFoundSurface } from '@/components/app/NotFoundSurface';

export default function LocaleNotFound(): React.JSX.Element {
    return <NotFoundSurface />;
}
