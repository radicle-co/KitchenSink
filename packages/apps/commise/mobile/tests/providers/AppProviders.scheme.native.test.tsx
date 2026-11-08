/**
 * `AppProviders` mounts Tamagui with the design system's config and the scheme the DEVICE is in (D17: the scheme
 * follows the OS, live, with no stored override). A hard-coded `defaultTheme="light"` painted every Tamagui surface
 * light on a dark device. Tamagui re-themes the tree when `defaultTheme` changes after mount (`ThemeProvider` renders
 * `<Theme name={defaultTheme}>`), so the provider must pass the CURRENT scheme on every render.
 *
 * A stand-in `TamaguiProvider` prints the scheme it receives and records the config; the real one would render the same
 * children.
 */
// AppProviders mounts the design-system provider itself, so it is rendered without one (`renderUnscoped`).
import { act, cleanup, screen, render as renderUnscoped } from '@testing-library/react';
import { useAuth } from '@clerk/expo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Text } from 'react-native';

import { tamaguiConfig } from '@commise/ui/tamagui-config';

const { clerk, scheme, received } = vi.hoisted(() => ({
    clerk: { session: null },
    scheme: { current: null as 'light' | 'dark' | null },
    received: { config: undefined as unknown },
}));

vi.mock('react-native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-native')>()),
    useColorScheme: () => scheme.current,
}));

vi.mock('../../src/observability/sentryErrorReporter.js', () => ({ reportErrorToSentry: vi.fn() }));

vi.mock('@clerk/expo', () => ({
    ClerkProvider: ({ children }: { readonly children?: unknown }) => children,
    useAuth: vi.fn(),
    useClerk: () => clerk,
}));

vi.mock('../../src/i18n/LocaleProvider.js', () => ({
    LocaleProvider: ({ children }: { readonly children?: unknown }) => children,
}));

vi.mock('../../src/storage/tokenCache.js', () => ({ tokenCache: {} }));

vi.mock('tamagui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('tamagui')>();
    const { createElement, Fragment } = await import('react');

    return {
        ...actual,
        TamaguiProvider: ({
            config,
            defaultTheme,
            children,
        }: {
            readonly config: unknown;
            readonly defaultTheme?: string;
            readonly children?: unknown;
        }) => {
            // Recorded, not compared here: importing the design-system config inside this factory would import
            // `tamagui` while its own mock is still being built.
            received.config = config;

            return createElement(
                Fragment,
                null,
                createElement(Text, null, `theme:${String(defaultTheme)}`),
                children as never,
            );
        },
    };
});

const { AppProviders } = await import('../../src/providers/AppProviders.js');

function App() {
    return (
        <AppProviders>
            <Text>child</Text>
        </AppProviders>
    );
}

beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok_abc') } as unknown as ReturnType<
        typeof useAuth
    >);
});

afterEach(() => {
    cleanup();
    scheme.current = null;
    received.config = undefined;
});

describe('AppProviders, Tamagui config and scheme', () => {
    it('mounts Tamagui with the design system’s config', async () => {
        renderUnscoped(<App />);

        expect(await screen.findByText('child')).toBeTruthy();
        expect(received.config).toBe(tamaguiConfig);
    });

    it.each([
        ['dark', 'dark'],
        ['light', 'light'],
        [null, 'light'],
    ] as const)('gives Tamagui the %s device scheme as %s', async (system, expected) => {
        scheme.current = system;
        renderUnscoped(<App />);

        expect(await screen.findByText(`theme:${expected}`)).toBeTruthy();
        expect(screen.getByText('child')).toBeTruthy();
    });

    it('follows a scheme change on the device after mount', async () => {
        scheme.current = 'light';
        const { rerender } = renderUnscoped(<App />);

        expect(await screen.findByText('theme:light')).toBeTruthy();

        scheme.current = 'dark';
        act(() => {
            rerender(<App />);
        });

        expect(await screen.findByText('theme:dark')).toBeTruthy();
    });
});
