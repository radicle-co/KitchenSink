import { auth } from '@clerk/nextjs/server';
import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { WelcomeContent } from '@/components/auth/WelcomeContent';
import { getDictionary } from '@/i18n/getDictionary';

export const dynamic = 'force-dynamic';

/**
 * The branded auth-entry / welcome route (U8). The signed-out front door: `/` bounces unauthenticated
 * users here (not straight to the bare sign-in form), and this hero leads into sign-up ("Get started") or
 * sign-in. A signed-IN request is bounced to Home, so the welcome hero is only ever shown pre-auth.
 *
 * The CTA hrefs are BARE locale paths: they are navigated by Next's `<Link>`, which prepends the build-time
 * basePath itself (a `withBasePath`-prefixed value would double-prefix under a preview — see the layout's
 * Clerk-URL note and ADR-0001).
 */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId } = await auth();

    if (userId) {
        redirect(`/${locale}` as Route);
    }

    const { welcome } = getDictionary(locale);

    return (
        <WelcomeContent
            messages={welcome}
            signUpHref={`/${locale}/sign-up` as Route}
            signInHref={`/${locale}/sign-in` as Route}
        />
    );
}
