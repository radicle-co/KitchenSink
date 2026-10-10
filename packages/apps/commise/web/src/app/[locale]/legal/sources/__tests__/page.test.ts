/**
 * The `/legal/sources` route's document metadata (curated U25, design §S16): the browser tab's title and the
 * description a shared link shows come from the message catalogue, for the request's locale, never from a literal in
 * the route (CLAUDE.md "Localize user-facing strings"; `docs/design/readSurfacesEvaluation.md` D11).
 *
 * The route is invoked as the plain module Next loads, as `appShellRoutes.test.tsx` does, with Clerk and the navigation
 * module stood in for, because importing the page imports them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const getDictionary = vi.hoisted(() => vi.fn());

vi.mock('@/i18n/getDictionary', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/i18n/getDictionary')>();

    getDictionary.mockImplementation(actual.getDictionary);

    return { getDictionary };
});

const route = await import('../page');
const { getDictionary: realDictionary } =
    await vi.importActual<typeof import('@/i18n/getDictionary')>('@/i18n/getDictionary');

afterEach(() => {
    getDictionary.mockImplementation(realDictionary);
});

const paramsFor = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe('/legal/sources metadata', () => {
    it('reads the title and the description from the catalogue, for the request’s locale', async () => {
        const dictionary = realDictionary('en');

        getDictionary.mockReturnValue({
            ...dictionary,
            pageMetadata: { dataSources: { title: 'Datenquellen | Commise', description: 'Woher die Zahlen kommen' } },
        });

        await expect(route.generateMetadata(paramsFor('de'))).resolves.toEqual({
            title: 'Datenquellen | Commise',
            description: 'Woher die Zahlen kommen',
        });
        expect(getDictionary).toHaveBeenCalledWith('de');
    });

    // §S19 chose US English, as the page itself says "License".
    it('says, in English, what the page is, with the US spelling', async () => {
        await expect(route.generateMetadata(paramsFor('en'))).resolves.toEqual({
            title: 'Data sources | Commise',
            description: 'The food databases behind the nutrition figures, and their licenses',
        });
    });

    // Next refuses a segment that exports both.
    it('exports no static metadata beside the generator', () => {
        expect('metadata' in route).toBe(false);
    });
});
