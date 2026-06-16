import { SignIn } from '@clerk/nextjs';
import { clerkAppearance } from '@kitchensink/ui';

import { withBasePath } from '@/lib/base-path';

export default function SignInPage() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-12">
            {/* hash routing: Clerk derives its path from usePathname() (basePath-STRIPPED), so under a
                preview basePath (/pr-{N}) path routing can't reconcile and renders an empty widget.
                Hash routing drives the multi-step flow via the URL fragment, independent of basePath.
                Redirect/cross-link URLs must be basePath-prefixed — Clerk's redirects are NOT
                basePath-aware (ADR-0001); fallbackRedirectUrl honors any ?redirect_url, else lands
                on the app root instead of stranding the user on /sign-in. */}
            <SignIn
                routing="hash"
                appearance={clerkAppearance}
                signUpUrl={withBasePath('/sign-up')}
                fallbackRedirectUrl={withBasePath('/')}
            />
        </main>
    );
}
