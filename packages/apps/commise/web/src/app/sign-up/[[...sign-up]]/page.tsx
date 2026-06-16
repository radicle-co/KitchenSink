import { SignUp } from '@clerk/nextjs';
import { clerkAppearance } from '@kitchensink/ui';

import { withBasePath } from '@/lib/base-path';

export default function SignUpPage() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-12">
            {/* hash routing — see sign-in: path routing renders an empty widget under a preview basePath
                because Clerk derives its path from the basePath-stripped usePathname().
                Redirect/cross-link URLs must be basePath-prefixed — Clerk's redirects are NOT
                basePath-aware (ADR-0001), so without fallbackRedirectUrl a completed sign-up strands
                the user on /sign-up instead of landing on the app. */}
            <SignUp
                routing="hash"
                appearance={clerkAppearance}
                signInUrl={withBasePath('/sign-in')}
                fallbackRedirectUrl={withBasePath('/')}
            />
        </main>
    );
}
