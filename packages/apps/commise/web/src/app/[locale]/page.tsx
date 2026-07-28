import { auth } from '@clerk/nextjs/server';
import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { HomeWidgetSurface } from '@/components/home';

export const dynamic = 'force-dynamic';

/**
 * The post-login Home route (US-000 / FR-046) AND the app's front door. The server segment gates auth — a
 * signed-out request goes STRAIGHT to the sign-in form — then renders the client {@link HomeWidgetSurface},
 * which discovers, curates, and renders the Home widgets. Signed-in users land HERE (the post sign-up/in
 * `forceRedirectUrl` is `/${locale}`), and the page RENDERS rather than bouncing to /profile, so a
 * freshly-signed-up user stays on Home.
 *
 * ⚠️ Owner decision, 2026-07-28: there is NO welcome/landing interstitial. This route previously bounced a
 * signed-out caller to a branded `/{locale}/welcome` hero, which then led into sign-in or sign-up; that
 * surface is deleted on BOTH platforms (mobile's `AuthGate` opens straight on its sign-in form for the same
 * reason). So the front door and every protected sub-route now agree: signed out ⇒ `/sign-in`. Do not
 * reintroduce an interstitial here — `src/app/[locale]/__tests__/page.test.tsx` asserts this target and
 * that NOTHING stands in front of it. Sign-UP stays reachable because the sign-in page passes Clerk a
 * `signUpUrl`, so `<SignIn>` renders its own "Sign up" link.
 *
 * The redirect target is a BARE locale path: `redirect()` runs through Next's prefix-aware routing, which
 * prepends the build-time basePath itself (a `withBasePath`-prefixed value would double-prefix under a
 * preview — see ADR-0001 and the sign-in page's note).
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <HomeWidgetSurface />;
}
