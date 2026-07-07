import { SignUp } from '@clerk/nextjs';
import { clerkAppearance } from '@commise/ui';

import { withBasePath } from '@/lib/base-path';

export default function SignUpPage() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-12">
            {/* hash routing — path routing renders an empty widget under a preview basePath because
                Clerk derives its path from the basePath-stripped usePathname().
                signInUrl is a page LOCATOR consumed as-is, so it must carry the basePath. But
                forceRedirectUrl is different: Clerk runs the post-sign-up redirect through Next's
                router, which ALREADY prepends basePath — so a pre-prefixed value double-prefixes to
                /pr-{N}/pr-{N}/ (a dead route) and strands the now-signed-in user on a blank /sign-up
                ("<SignUp/> cannot render when a user is already signed in"). Pass a BARE path and let
                Next add the prefix exactly once. (Same double-prefix class as the reverted 9d8e86a.)
                The OAuth/SSO-callback flow navigates this raw (router not wired during the callback
                page load), dropping the prefix to the bare root → 404; that landing is re-homed onto
                the basePath by the bare-root redirect in next.config.ts. See the sign-in page note. */}
            <SignUp
                routing="hash"
                appearance={clerkAppearance}
                signInUrl={withBasePath('/sign-in')}
                forceRedirectUrl="/"
            />
        </main>
    );
}
