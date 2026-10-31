/**
 * `SafeAreaProvider` wraps `TamaguiProvider`, not the other way round. Tamagui 3's safe-area integration reads the
 * insets of a `SafeAreaProvider` ABOVE it (its `SafeAreaTracker` and the Sheet's `useSafeAreaInsets` read
 * `SafeAreaInsetsContext`), and the v3 guide puts `SafeAreaProvider` outside `TamaguiProvider`. With it inside, every
 * Tamagui component that reads insets would see none.
 *
 * The test asks the question the way Tamagui does: a stand-in `TamaguiProvider` reads the safe-area context at render
 * and prints what it found. Both stand-ins wrap the real ones' children unchanged, so the rest of the tree renders as
 * the app does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useAuth } from '@clerk/expo';
import { Text } from 'react-native';

const { clerk } = vi.hoisted(() => ({ clerk: { session: null } }));

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

vi.mock('react-native-safe-area-context', async () => {
    const { createContext, createElement } = await import('react');
    const SafeAreaInsetsContext = createContext<string | null>(null);

    return {
        SafeAreaInsetsContext,
        SafeAreaProvider: ({ children }: { readonly children?: unknown }) =>
            createElement(SafeAreaInsetsContext.Provider, { value: 'insets' }, children as never),
    };
});

vi.mock('tamagui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('tamagui')>();
    const { createElement, Fragment, useContext } = await import('react');
    const { SafeAreaInsetsContext } = (await import('react-native-safe-area-context')) as unknown as {
        readonly SafeAreaInsetsContext: import('react').Context<string | null>;
    };

    return {
        ...actual,
        TamaguiProvider: ({ children }: { readonly children?: unknown }) => {
            const insets = useContext(SafeAreaInsetsContext);

            return createElement(
                Fragment,
                null,
                createElement(Text, null, insets === null ? 'tamagui-without-insets' : 'tamagui-with-insets'),
                children as never,
            );
        },
    };
});

beforeEach(() => {
    vi.stubEnv('EXPO_PUBLIC_IDP_PUBLISHABLE_KEY', 'pk_test_bmljZS1mb3dsLTYuY2xlcmsuYWNjb3VudHMuZGV2JA');
    vi.mocked(useAuth).mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok_abc') } as unknown as ReturnType<
        typeof useAuth
    >);
});

afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe('AppProviders, safe area and Tamagui', () => {
    it('mounts SafeAreaProvider above TamaguiProvider, so Tamagui can read the insets', async () => {
        const { AppProviders } = await import('../../src/providers/AppProviders.js');

        render(
            <AppProviders>
                <Text>child</Text>
            </AppProviders>,
        );

        expect(await screen.findByText('tamagui-with-insets')).toBeTruthy();
        expect(screen.getByText('child')).toBeTruthy();
    });
});
