import { auth } from '@clerk/nextjs/server';
import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { HomeWidgetSurface } from '@/components/home';

export const dynamic = 'force-dynamic';

/**
 * The post-login Home route (US-000 / FR-046). The server segment gates auth — a signed-out request is
 * bounced to the branded welcome/auth-entry hero (U8; `/welcome` then leads into sign-in/sign-up) rather
 * than straight to the bare sign-in form — then renders the client {@link HomeWidgetSurface}, which
 * discovers, curates, and renders the Home widgets. Signed-in users land HERE (the post sign-up/in
 * `forceRedirectUrl` is `/${locale}`), and the page RENDERS rather than bouncing to /profile, so a
 * freshly-signed-up user stays on Home. (Protected sub-routes still bounce to `/sign-in` directly — the
 * welcome hero is the FRONT-DOOR landing, not a gate on every deep link.)
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/welcome` as Route);
    }

    return <HomeWidgetSurface />;
}
