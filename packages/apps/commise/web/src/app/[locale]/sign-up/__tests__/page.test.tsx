// @vitest-environment jsdom
/**
 * The sign-up page composes the frame and the form with the two URLs that must differ: `signInUrl` carries the preview
 * basePath, `forceRedirectUrl` does not (see the sign-in page's suite).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/basePath', () => ({ withBasePath: (path: string) => `/pr-9${path}` }));
vi.mock('@/components/auth/SignUpForm', () => ({
    SignUpForm: (props: { signInUrl: string; forceRedirectUrl: string }) => (
        <p>{`${props.signInUrl}|${props.forceRedirectUrl}`}</p>
    ),
}));
vi.mock('@/components/auth/AuthSplitLayout', () => ({
    AuthSplitLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import SignUpPage from '../[[...sign-up]]/page';

afterEach(cleanup);

describe('the sign-up page', () => {
    it('gives the form a basePath-prefixed sign-in URL and a BARE redirect', async () => {
        render(await SignUpPage({ params: Promise.resolve({ locale: 'en' }) }));

        expect(screen.getByText('/pr-9/en/sign-in|/en')).toBeTruthy();
    });
});
