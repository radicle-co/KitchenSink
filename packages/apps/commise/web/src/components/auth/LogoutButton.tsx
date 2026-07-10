'use client';

import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';

import { withBasePath } from '@/lib/basePath';

interface LogoutButtonProps {
    children?: React.ReactNode;
}

export function LogoutButton({ children }: LogoutButtonProps) {
    const [isLoading, setIsLoading] = useState(false);
    const { signOut } = useClerk();

    const handleLogout = async () => {
        setIsLoading(true);
        // Clerk's redirectUrl is not basePath-aware (ADR-0001 / U2); prefix it. No-op in production.
        await signOut({ redirectUrl: withBasePath('/') });
    };

    return (
        <button type="button" onClick={handleLogout} disabled={isLoading} aria-busy={isLoading}>
            {children ?? 'Sign out of your account'}
        </button>
    );
}
