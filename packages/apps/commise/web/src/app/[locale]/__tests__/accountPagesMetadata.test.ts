/**
 * The document metadata of the profile, data sources, sign-in and sign-up routes: the browser tab's title and a shared link's description
 * come from the message catalogue, for the request's locale, never from a literal in the route (CLAUDE.md "Localize
 * user-facing strings"). The Data sources route established the shape (`legal/sources/__tests__/page.test.ts`).
 *
 * The routes are invoked as the plain modules Next loads, with Clerk and the navigation module stood in for, because
 * importing a page imports them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
// The auth pages import Clerk's client widgets, which this node suite has no use for.
vi.mock('@/components/auth/SignInForm', () => ({ SignInForm: () => null }));
vi.mock('@/components/auth/SignUpForm', () => ({ SignUpForm: () => null }));
vi.mock('@/components/auth/AuthSplitLayout', () => ({ AuthSplitLayout: () => null }));

const getDictionary = vi.hoisted(() => vi.fn());

vi.mock('@/i18n/getDictionary', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/i18n/getDictionary')>();

    getDictionary.mockImplementation(actual.getDictionary);

    return { getDictionary };
});

const { getDictionary: realDictionary } =
    await vi.importActual<typeof import('@/i18n/getDictionary')>('@/i18n/getDictionary');

const ROUTES = {
    profile: await import('../profile/page'),
    dataSources: await import('../legal/sources/page'),
    signIn: await import('../sign-in/[[...sign-in]]/page'),
    signUp: await import('../sign-up/[[...sign-up]]/page'),
} as const;

afterEach(() => {
    getDictionary.mockImplementation(realDictionary);
});

const paramsFor = (locale: string) => ({ params: Promise.resolve({ locale }) });

// The separator is the middle dot the shell's client title uses (`buildSpec.md` §10: "{page} · Commise"), so the
// server-rendered title and the one the shell sets after navigation read the same (W-15, SC 2.4.2).
describe.each([
    ['profile', 'Profile · Commise', 'Your user profile'],
    ['dataSources', 'Data sources · Commise', 'The food databases behind the nutrition figures, and their licenses'],
    ['signIn', 'Sign in · Commise', 'Sign in to your Commise account'],
    ['signUp', 'Create your account · Commise', 'Create a Commise account to keep your recipes in one place'],
] as const)('/%s metadata', (page, title, description) => {
    const route = ROUTES[page];

    it('reads the title and the description from the catalogue, for the request’s locale', async () => {
        const dictionary = realDictionary('en');

        getDictionary.mockReturnValue({
            ...dictionary,
            pageMetadata: {
                ...dictionary.pageMetadata,
                [page]: { title: `«${page}» · Commise`, description: `«${page}»` },
            },
        });

        await expect(route.generateMetadata(paramsFor('de'))).resolves.toEqual({
            title: `«${page}» · Commise`,
            description: `«${page}»`,
        });
        expect(getDictionary).toHaveBeenCalledWith('de');
    });

    it('keeps its English copy', async () => {
        await expect(route.generateMetadata(paramsFor('en'))).resolves.toEqual({ title, description });
    });

    // Next refuses a segment that exports both.
    it('exports no static metadata beside the generator', () => {
        expect('metadata' in route).toBe(false);
    });
});
