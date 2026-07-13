import { SignIn } from '@clerk/nextjs';
import { clerkAppearance } from '@commise/ui';

import { withBasePath } from '@/lib/basePath';

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;

    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-12">
            {/* hash routing: Clerk derives its path from usePathname() (basePath-STRIPPED), so under a
                preview basePath (/pr-{N}) path routing can't reconcile and renders an empty widget.
                Hash routing drives the multi-step flow via the URL fragment, independent of basePath.
                signUpUrl is a page LOCATOR consumed as-is, so it must carry the basePath. But
                forceRedirectUrl runs through Next's router (which already prepends basePath), so a
                pre-prefixed value double-prefixes to /pr-{N}/pr-{N}/ and strands the signed-in user —
                pass a BARE path and let Next add the prefix once. (See the sign-up page note.)
                The bare '/' is RIGHT for the password flow (router branch) but the OAuth/SSO-callback
                flow navigates this via raw window.location (its Next router isn't wired during the
                callback page load), which would drop the prefix and land on the bare root → 404. That
                raw-branch landing is re-homed onto the basePath by the bare-root redirect in
                next.config.ts — do NOT prefix forceRedirectUrl to "fix" OAuth or password breaks. */}
            {/* forceRedirectUrl='/' is ALSO the sole guard against an open redirect: clerkMiddleware's
                protected-route bounce appends `?redirect_url=<original path>` to this sign-in URL, and
                forcing '/' ignores it. If you ever add return-to-original-route, validate redirect_url
                is same-origin before honoring it. Known trade-off today: a deep-linked /profile
                (bookmark or shared link) → after sign-in the user lands on home, not /profile — an
                accepted cost while return-to is deferred. */}
            <SignIn
                routing="hash"
                appearance={clerkAppearance}
                signUpUrl={withBasePath(`/${locale}/sign-up`)}
                forceRedirectUrl={`/${locale}`}
            />
        </main>
    );
}
