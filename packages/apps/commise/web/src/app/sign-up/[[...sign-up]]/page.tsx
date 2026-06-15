import { SignUp } from '@clerk/nextjs';
import { clerkAppearance } from '@kitchensink/ui';

export default function SignUpPage() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-12">
            {/* hash routing — see sign-in: path routing renders an empty widget under a preview basePath
                because Clerk derives its path from the basePath-stripped usePathname(). */}
            <SignUp routing="hash" appearance={clerkAppearance} />
        </main>
    );
}
