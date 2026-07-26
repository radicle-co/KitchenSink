'use client';

import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';

import { withBasePath } from '@/lib/basePath';
import { authMessages } from '@/components/auth/messages';
import { LogOutIcon } from '@/components/auth/icons';

interface LogoutButtonProps {
    /** Overrides the default localized "Sign out" label (e.g. a page-specific phrasing). */
    children?: React.ReactNode;
}

export function LogoutButton({ children }: LogoutButtonProps) {
    const { session } = useMessages(authMessages);
    const [isLoading, setIsLoading] = useState(false);
    const { signOut } = useClerk();

    const handleLogout = async () => {
        setIsLoading(true);
        // Clerk's redirectUrl is not basePath-aware (ADR-0001 / U2); prefix it. No-op in production.
        await signOut({ redirectUrl: withBasePath('/') });
    };

    return (
        <Button variant="secondary" icon={<LogOutIcon />} onPress={handleLogout} busy={isLoading}>
            {isLoading ? session.signingOut : (children ?? session.signOut)}
        </Button>
    );
}
