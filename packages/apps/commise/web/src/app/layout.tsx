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
        // Clerk URL props are NOT basePath-aware (ADR-0001 / U2), so prefix them explicitly. No-op in
        // production where the base path is empty.
        <ClerkProvider
            signInUrl={withBasePath('/sign-in')}
            signUpUrl={withBasePath('/sign-up')}
            signInFallbackRedirectUrl={withBasePath('/')}
            signUpFallbackRedirectUrl={withBasePath('/')}
            afterSignOutUrl={withBasePath('/')}
        >
            <html lang="en">
                <body>{children}</body>
            </html>
        </ClerkProvider>
    );
}
