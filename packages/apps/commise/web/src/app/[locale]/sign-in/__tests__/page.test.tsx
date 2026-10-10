// @vitest-environment jsdom
/**
 * The sign-in page composes the frame and the form with the two URLs that must differ: `signUpUrl` carries the preview
 * basePath, `forceRedirectUrl` does not (a pre-prefixed redirect double-prefixes and strands the signed-in user).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/basePath', () => ({ withBasePath: (path: string) => `/pr-9${path}` }));
vi.mock('@/components/auth/SignInForm', () => ({
    SignInForm: (props: { signUpUrl: string; forceRedirectUrl: string }) => (
        <p>{`${props.signUpUrl}|${props.forceRedirectUrl}`}</p>
    ),
}));
vi.mock('@/components/auth/AuthSplitLayout', () => ({
    AuthSplitLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import SignInPage from '../[[...sign-in]]/page';

afterEach(cleanup);

describe('the sign-in page', () => {
    it('gives the form a basePath-prefixed sign-up URL and a BARE redirect', async () => {
        render(await SignInPage({ params: Promise.resolve({ locale: 'en' }) }));

        expect(screen.getByText('/pr-9/en/sign-up|/en')).toBeTruthy();
    });
});
