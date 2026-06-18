import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { withBasePath } from '@/lib/base-path';

export const metadata: Metadata = {
    title: 'Commise',
    description: 'Your personal AI-powered recipe assistant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        // Two classes of Clerk URL prop behave differently under a preview basePath (ADR-0001 / U2):
        //  - LOCATOR / raw-navigation props (where the sign-in/up pages live; the post-sign-OUT target,
        //    which Clerk hard-navigates) are consumed as-is, so they MUST carry the basePath.
        //  - post-sign-in/up REDIRECT props go through Next's router, which already prepends basePath —
        //    a pre-prefixed value double-prefixes to /pr-{N}/pr-{N}/, so they take a BARE path.
        // All no-ops in production where the base path is empty.
        <ClerkProvider
            signInUrl={withBasePath('/sign-in')}
            signUpUrl={withBasePath('/sign-up')}
            signInFallbackRedirectUrl="/"
            signUpFallbackRedirectUrl="/"
            afterSignOutUrl={withBasePath('/')}
        >
            <html lang="en">
                <body>{children}</body>
            </html>
        </ClerkProvider>
    );
}
