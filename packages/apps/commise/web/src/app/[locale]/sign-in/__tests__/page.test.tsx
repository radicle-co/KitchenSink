// @vitest-environment jsdom
/**
 * The sign-in page composes the frame and the form with the two URLs that must differ: `signUpUrl` carries the preview
 * basePath, `forceRedirectUrl` does not (a pre-prefixed redirect double-prefixes and strands the signed-in user).
 *
 * W-01: `forceRedirectUrl` is the validated `redirect_url` the protected page sent, and the sign-up link carries the
 * same destination so registering does not lose it. A value `safeReturnPath` refuses (the open-redirect shapes) falls
 * back to the locale root — the guard the form's own docblock names — and is not forwarded to the sign-up link.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/basePath', () => ({
    BASE_PATH: '/pr-9',
    withBasePath: (path: string) => `/pr-9${path}`,
}));
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

const renderPage = async (redirectUrl?: string | string[]) =>
    render(
        await SignInPage({
            params: Promise.resolve({ locale: 'en' }),
            searchParams: Promise.resolve(redirectUrl === undefined ? {} : { redirect_url: redirectUrl }),
        }),
    );

describe('the sign-in page', () => {
    it('gives the form a basePath-prefixed sign-up URL and a BARE redirect', async () => {
        await renderPage();

        expect(screen.getByText('/pr-9/en/sign-up|/en')).toBeTruthy();
    });

    it('lands the visitor on the page they were sent from, and carries it to the sign-up link', async () => {
        await renderPage('/en/collections');

        expect(screen.getByText('/pr-9/en/sign-up?redirect_url=%2Fen%2Fcollections|/en/collections')).toBeTruthy();
    });

    it('strips the basePath from a destination that carries it, so the redirect stays bare', async () => {
        await renderPage('/pr-9/en/recipes');

        expect(screen.getByText('/pr-9/en/sign-up?redirect_url=%2Fen%2Frecipes|/en/recipes')).toBeTruthy();
    });

    it.each([
        ['a protocol-relative URL', '//evil.com'],
        ['an absolute URL', 'https://evil.com/en'],
        ['a backslash host', '/\\evil.com'],
        ['another locale', '/de/collections'],
        ['a repeated parameter', ['/en/a', '/en/b']],
    ])('falls back to the locale root for %s, and does not forward it', async (_what, hostile) => {
        await renderPage(hostile);

        expect(screen.getByText('/pr-9/en/sign-up|/en')).toBeTruthy();
    });
});
