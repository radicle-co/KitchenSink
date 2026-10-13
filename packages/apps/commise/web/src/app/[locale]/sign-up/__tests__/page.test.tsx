// @vitest-environment jsdom
/**
 * The sign-up page composes the frame and the form with the two URLs that must differ: `signInUrl` carries the preview
 * basePath, `forceRedirectUrl` does not (see the sign-in page's suite). The destination a visitor was sent from
 * (`redirect_url`, W-01) is validated the same way and carried back to the sign-in link.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/basePath', () => ({
    BASE_PATH: '/pr-9',
    withBasePath: (path: string) => `/pr-9${path}`,
}));
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

const renderPage = async (redirectUrl?: string | string[]) =>
    render(
        await SignUpPage({
            params: Promise.resolve({ locale: 'en' }),
            searchParams: Promise.resolve(redirectUrl === undefined ? {} : { redirect_url: redirectUrl }),
        }),
    );

describe('the sign-up page', () => {
    it('gives the form a basePath-prefixed sign-in URL and a BARE redirect', async () => {
        await renderPage();

        expect(screen.getByText('/pr-9/en/sign-in|/en')).toBeTruthy();
    });

    it('lands the new account on the page the visitor was sent from, and carries it to the sign-in link', async () => {
        await renderPage('/en/collections');

        expect(screen.getByText('/pr-9/en/sign-in?redirect_url=%2Fen%2Fcollections|/en/collections')).toBeTruthy();
    });

    it('strips the basePath from a destination that carries it', async () => {
        await renderPage('/pr-9/en/recipes');

        expect(screen.getByText('/pr-9/en/sign-in?redirect_url=%2Fen%2Frecipes|/en/recipes')).toBeTruthy();
    });

    it.each([
        ['a protocol-relative URL', '//evil.com'],
        ['an absolute URL', 'https://evil.com/en'],
        ['a backslash host', '/\\evil.com'],
        ['a repeated parameter', ['/en/a', '/en/b']],
    ])('falls back to the locale root for %s, and does not forward it', async (_what, hostile) => {
        await renderPage(hostile);

        expect(screen.getByText('/pr-9/en/sign-in|/en')).toBeTruthy();
    });
});
