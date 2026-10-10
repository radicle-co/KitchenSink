// @vitest-environment jsdom
/**
 * The sign-in and sign-up forms around Clerk's widgets (`docs/design/uiOverhaul/buildSpec.md` §8). Clerk is stood in
 * for by a probe that records the props it was given, so what is asserted is exactly what the app asks Clerk to draw:
 * hash routing (the preview basePath cannot reconcile path routing), the sign-up URL that is the ONLY way to register
 * (FR-045a), and an appearance built for the browser's scheme — dark when the
 * system is dark.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@commise/test-utils';

type Props = Record<string, unknown> & {
    appearance: { variables: { colorBackground: string }; cssLayerName: string };
};

const { seen } = vi.hoisted(() => ({ seen: { signIn: undefined as unknown, signUp: undefined as unknown } }));

vi.mock('@clerk/nextjs', () => ({
    SignIn: (props: unknown) => {
        seen.signIn = props;

        return <div data-clerk="sign-in" />;
    },
    SignUp: (props: unknown) => {
        seen.signUp = props;

        return <div data-clerk="sign-up" />;
    },
}));

const { SignInForm } = await import('../SignInForm');
const { SignUpForm } = await import('../SignUpForm');
const { clerkAppearanceFor } = await import('@commise/ui');

/** Make `matchMedia` report the given scheme. */
function setScheme(scheme: 'light' | 'dark'): void {
    window.matchMedia = ((query: string) => ({
        matches: scheme === 'dark' && query.includes('dark'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
    seen.signIn = undefined;
    seen.signUp = undefined;
    setScheme('light');
});

afterEach(cleanup);

describe('SignInForm', () => {
    const mount = (): Props => {
        renderWithProviders(<SignInForm signUpUrl="/pr-1/en/sign-up" forceRedirectUrl="/en" />);

        return seen.signIn as Props;
    };

    it('mounts Clerk’s sign-in with hash routing and the page’s two URLs', () => {
        const props = mount();

        expect(props['routing']).toBe('hash');
        expect(props['signUpUrl']).toBe('/pr-1/en/sign-up');
        expect(props['forceRedirectUrl']).toBe('/en');
    });

    it('builds the light appearance in a light browser', () => {
        expect(mount().appearance).toEqual(clerkAppearanceFor('light'));
    });

    it('builds the dark appearance in a dark browser — the form is not left light on a dark page', () => {
        setScheme('dark');

        const props = mount();

        expect(props.appearance).toEqual(clerkAppearanceFor('dark'));
        expect(props.appearance.variables.colorBackground).not.toBe(
            clerkAppearanceFor('light').variables.colorBackground,
        );
    });
});

describe('SignUpForm', () => {
    const mount = (): Props => {
        renderWithProviders(<SignUpForm signInUrl="/pr-1/en/sign-in" forceRedirectUrl="/en" />);

        return seen.signUp as Props;
    };

    it('mounts Clerk’s sign-up with hash routing and the page’s two URLs', () => {
        const props = mount();

        expect(props['routing']).toBe('hash');
        expect(props['signInUrl']).toBe('/pr-1/en/sign-in');
        expect(props['forceRedirectUrl']).toBe('/en');
    });

    it('builds its appearance for the browser’s scheme too', () => {
        setScheme('dark');

        expect(mount().appearance).toEqual(clerkAppearanceFor('dark'));
    });

    it('renders only the widget (the layout is the page’s)', () => {
        const { container } = render(<SignUpForm signInUrl="/x" forceRedirectUrl="/en" />);

        expect(container.querySelector('[data-clerk="sign-up"]')).not.toBeNull();
    });
});
