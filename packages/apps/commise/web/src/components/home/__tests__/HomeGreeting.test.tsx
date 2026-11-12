// @vitest-environment jsdom
/**
 * Component tests for the web Home greeting (US-000 / FR-046). The greeting is time-of-day aware and the
 * subtitle is a locale-formatted date; both derive from the viewer's local clock. These freeze the clock with
 * fake timers so every time-of-day bucket is asserted deterministically — a greeting that ignored the hour
 * (e.g. hard-coded "Good afternoon") would fail every non-afternoon case.
 *
 * The last two suites are the ones that matter for #144: this surface is SERVER-rendered and then hydrated, so
 * a client-only `render()` (every suite above them) cannot tell whose clock produced the text. They drive the
 * real `renderToString` → `hydrateRoot` sequence with the two clocks DISAGREEING, which is the only shape that
 * distinguishes "the viewer's clock" from "the Next server's clock".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { homeMessages } from '@commise/features-core/home';
import { LocaleProvider } from '@commise/i18n/react';
import { renderWithProviders } from '@commise/test-utils';
import { CreateFab } from '@commise/ui/create-fab';

import { HomeGreeting } from '../HomeGreeting';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** Render the greeting with the clock frozen at a fixed LOCAL instant. */
const renderAt = (year: number, monthIndex: number, day: number, hour: number, locale = 'en', name?: string): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, monthIndex, day, hour, 0, 0));

    renderWithProviders(<HomeGreeting {...(name === undefined ? {} : { name })} />, { locale });
};

/** Every greeting string the dictionary can produce — used to assert that NO bucket leaks into the SSR pass. */
const EVERY_GREETING: readonly string[] = Object.values(homeMessages.en.greetings);

/**
 * Designer ruling, web only (`nativeBoards/designAnswers.md`, 438f7e542): below 400 px of window height the New recipe
 * button stops floating and takes its own row under the header, after the greeting and the date, 16 below the date,
 * start-aligned, in flow, with no shadow. (The header's avatar is gone — owner ruling 2026-11-11, N3 — so these tests no longer
 * hand the header an action; the button's row placement is unchanged.)
 * jsdom has no media queries: the floating-only classes sit behind the `fab-floats` variant, so what is pinned here is the
 * order in the page and the classes that put it on its own row.
 */
describe('HomeGreeting (web) — the New recipe button below 400 px of height', () => {
    const renderHeader = (): HTMLElement => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
        renderWithProviders(
            <HomeGreeting
                name="Eliza"
                afterTitle={<CreateFab label="New recipe" icon="plus" onPress={() => undefined} />}
            />,
            { locale: 'en' },
        );

        return screen.getByRole('button', { name: 'New recipe' });
    };

    const follows = (first: Element, second: Element): boolean =>
        Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    it('comes after the greeting and the date in the page, so it can never overlap them', () => {
        const create = renderHeader();

        expect(follows(screen.getByRole('heading', { level: 1 }), create)).toBe(true);
        expect(follows(screen.getByText(/^Sunday, May 31/u), create)).toBe(true);
    });

    it('spans the row beneath the title block rather than sitting at the end of the H1 row', () => {
        const classes = renderHeader().className.split(' ');

        expect(classes).toEqual(expect.arrayContaining(['col-span-3', 'justify-self-start', 'mt-4']));
        expect(classes).not.toContain('justify-self-end');
    });

    it('is in normal flow with no shadow until the window is tall enough to float it', () => {
        const classes = renderHeader().className.split(' ');

        for (const out of ['fixed', 'absolute', 'sticky', 'shadow-lg']) {
            expect(classes).not.toContain(out);
        }

        expect(classes).toEqual(expect.arrayContaining(['fab-floats:fixed', 'fab-floats:shadow-lg']));
    });
});

describe('HomeGreeting (web) — time-of-day bucket', () => {
    // Each row is [hour, expected greeting]. The boundary hours (5, 12, 17, 22) are chosen on purpose: they
    // are where the bucket flips, so an off-by-one in the shared bucketer is caught here.
    it.each([
        [8, 'Good morning'],
        [5, 'Good morning'],
        [14, 'Good afternoon'],
        [12, 'Good afternoon'],
        [19, 'Good evening'],
        [17, 'Good evening'],
        [23, 'Still up?'],
        [2, 'Still up?'],
    ])('at hour %i greets "%s"', (hour, expected) => {
        renderAt(2026, 4, 31, hour);

        expect(screen.getByRole('heading', { name: expected })).toBeTruthy();
    });
});

/**
 * Slice 3 of the overhaul (`buildSpec.md` §4.2): the greeting IS the page's H1, in the large title, and names the cook
 * when there is a name — "Good afternoon, Eliza" — and plainly greets when there is none.
 */
describe('HomeGreeting (web) — the large title', () => {
    it('is the one level-1 heading', () => {
        renderAt(2026, 4, 31, 14);

        expect(screen.getByRole('heading', { level: 1, name: 'Good afternoon' })).toBeTruthy();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it.each([
        [8, 'Good morning, Eliza'],
        [14, 'Good afternoon, Eliza'],
        [19, 'Good evening, Eliza'],
        [2, 'Still up, Eliza?'],
    ])('at hour %i greets the cook by name: "%s"', (hour, expected) => {
        renderAt(2026, 4, 31, hour, 'en', 'Eliza');

        expect(screen.getByRole('heading', { level: 1, name: expected })).toBeTruthy();
    });
});

/**
 * The Home header board (HomeWeb1280 / HomeIphone390): ONE row holding the greeting and the date stacked on the start side
 * and NOTHING on the end side — the profile avatar left the title row (owner ruling 2026-11-11, N3; it is the You tab and
 * the sidebar's first row now). jsdom loads no stylesheet, so the row is pinned by structure and by the utilities that
 * make it a row. Rewritten from the board that drew the 44 px profile button at the end of this row.
 */
describe('HomeGreeting (web) — the one-row header', () => {
    const renderRow = (): HTMLElement => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
        renderWithProviders(<HomeGreeting name="Eliza" afterTitle={<button type="button">New recipe</button>} />, {
            locale: 'en',
        });

        return screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    };

    it('holds only the text block in the row: no profile button at the end', () => {
        const header = renderRow();
        const row = header.firstElementChild as HTMLElement;

        expect(row.className).toMatch(/\bflex\b/u);
        expect(row.children).toHaveLength(1);
        expect(row.firstElementChild?.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
        expect(screen.queryByRole('button', { name: /profile/iu })).toBeNull();
        expect(screen.queryByRole('link', { name: /profile/iu })).toBeNull();
    });

    it('stacks the date directly under the greeting in the start block', () => {
        const header = renderRow();
        const text = (header.firstElementChild as HTMLElement).firstElementChild as HTMLElement;

        expect(text.children[0]?.tagName).toBe('H1');
        expect(text.children[1]?.textContent).toBe('Sunday, May 31');
    });

    it('keeps the create button right after the H1 in DOM order', () => {
        renderRow();
        const heading = screen.getByRole('heading', { level: 1 });
        const create = screen.getByRole('button', { name: 'New recipe' });

        expect(heading.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows the greeting and no button of its own', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
        renderWithProviders(<HomeGreeting />, { locale: 'en' });

        expect(screen.getByRole('heading', { level: 1, name: 'Good afternoon' })).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('HomeGreeting (web) — date subtitle', () => {
    it('renders the local calendar date without the year (board: "Sunday 25 October")', () => {
        // 2026-05-31 is a Sunday. Today is always in the current year, so the year is never shown.
        renderAt(2026, 4, 31, 14);

        expect(screen.getByText('Sunday, May 31')).toBeTruthy();
    });

    it('localizes the date for a non-English locale', () => {
        renderAt(2026, 4, 31, 14, 'es');

        // The Spanish month name proves the locale actually reached the formatter.
        expect(screen.getByText(/mayo/u)).toBeTruthy();
    });
});

/**
 * The SERVER pass on its own (#144). Whatever the Next server's clock says, the pre-hydration HTML must not
 * commit to a greeting — the server cannot know the viewer's zone, so any bucket it picked would be a guess
 * shown to the viewer, and a wrong greeting that later corrects itself is a visible defect of its own.
 */
describe('HomeGreeting (web) — the server-rendered pass commits to no clock reading', () => {
    /** The markup Next ships for the first paint, produced at a fixed SERVER instant. */
    const serverHtml = (instant: Date, locale = 'en'): string => {
        vi.useFakeTimers();
        vi.setSystemTime(instant);

        return renderToString(
            <LocaleProvider locale={locale}>
                <HomeGreeting />
            </LocaleProvider>,
        );
    };

    it('renders NO time-of-day greeting (any bucket) before hydration', () => {
        const html = serverHtml(new Date(2026, 4, 31, 14, 0, 0));

        for (const greeting of EVERY_GREETING) {
            expect(html, `server HTML leaked the "${greeting}" bucket`).not.toContain(greeting);
        }
    });

    it('renders NO calendar date before hydration', () => {
        const html = serverHtml(new Date(2026, 4, 31, 14, 0, 0));

        expect(html).not.toContain('May 31');
    });

    it('reserves the greeting block, hidden from assistive tech, so nothing shifts when the clock is read', () => {
        const container = document.createElement('div');
        container.innerHTML = serverHtml(new Date(2026, 4, 31, 14, 0, 0));

        // Hidden, not absent: a sighted viewer must not see the hero resize under the greeting, and a screen
        // reader must not be handed an empty heading to announce.
        const placeholder = container.querySelector('[aria-hidden="true"]');
        expect(placeholder).not.toBeNull();
        expect(within(container).queryByRole('heading')).toBeNull();
    });

    it('paints no animation on the placeholder (nothing is in flight, so nothing may pulse)', () => {
        const container = document.createElement('div');
        container.innerHTML = serverHtml(new Date(2026, 4, 31, 14, 0, 0));

        // A pulse would claim a fetch is running and would then owe `prefers-reduced-motion` handling for a
        // frame that is almost never seen. Static shapes owe neither.
        for (const node of container.querySelectorAll('*')) {
            expect(node.getAttribute('class') ?? '').not.toContain('animate-');
        }
    });
});

/**
 * The bug this suite exists for (#144): with `suppressHydrationWarning`, React KEEPS the server's text on a
 * suppressed mismatch — it does not patch it — so the greeting bucket and the long date were permanently the
 * Next server's clock and zone. Proven in the browser: with the client clock pinned to 03:00 (`night`) the DOM
 * still read "Good afternoon, Chef!".
 *
 * Every case here therefore renders on the server at ONE instant and hydrates at ANOTHER, and asserts the
 * CLIENT's reading won. The server instants are chosen to be a different bucket AND a different calendar day
 * from the client's, so a component that kept either half of the server's reading fails.
 */
describe('HomeGreeting (web) — the viewer’s clock wins over the server’s (#144)', () => {
    /**
     * Everything React recovered from during hydration. A hydration MISMATCH lands here — and deliberately not
     * on a `console.error` spy: React 19's default `onRecoverableError` prefers the global `reportError`, which
     * jsdom implements as a `window` error event, so a console spy silently observes nothing (verified: a
     * mismatch injected on purpose left `console.error` untouched). Collecting the callback React actually
     * calls is what makes "hydrates cleanly" an assertion instead of a hope.
     */
    let recovered: unknown[] = [];
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        recovered = [];
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    /**
     * Server-render at `serverInstant`, then hydrate the SAME markup with the clock moved to `clientInstant` —
     * the real sequence a viewer's browser performs.
     */
    const hydrateAt = async (serverInstant: Date, clientInstant: Date, locale = 'en'): Promise<HTMLElement> => {
        vi.useFakeTimers();
        vi.setSystemTime(serverInstant);

        const tree = (
            <LocaleProvider locale={locale}>
                <HomeGreeting />
            </LocaleProvider>
        );
        const container = document.createElement('div');
        container.innerHTML = renderToString(tree);
        document.body.append(container);

        vi.setSystemTime(clientInstant);
        await act(async () => {
            hydrateRoot(container, tree, {
                onRecoverableError: (error) => {
                    recovered.push(error);
                },
            });
        });

        return container;
    };

    // [server hour, client hour, the greeting the CLIENT's hour must produce]. Every bucket appears as a
    // client hour, and each is paired with a server hour in a DIFFERENT bucket.
    it.each([
        [14, 8, 'Good morning'],
        [2, 14, 'Good afternoon'],
        [8, 19, 'Good evening'],
        [14, 3, 'Still up?'],
    ])('server hour %i, client hour %i → greets "%s"', async (serverHour, clientHour, expected) => {
        const container = await hydrateAt(new Date(2026, 4, 31, serverHour, 0, 0), new Date(2026, 4, 31, clientHour));

        expect(within(container).getByRole('heading', { name: expected })).toBeTruthy();
    });

    it('shows only the client bucket — the server’s greeting is gone, not merely joined', async () => {
        const container = await hydrateAt(new Date(2026, 4, 31, 14, 0, 0), new Date(2026, 4, 31, 3, 0, 0));

        expect(within(container).getByRole('heading', { name: 'Still up?' })).toBeTruthy();
        expect(within(container).queryByText('Good afternoon')).toBeNull();
    });

    it('renders the CLIENT’s calendar day, not the server’s (a viewer past midnight is on tomorrow)', async () => {
        // The server is still on May 31; the viewer's own clock has already turned over to June 1.
        const container = await hydrateAt(new Date(2026, 4, 31, 22, 0, 0), new Date(2026, 5, 1, 3, 0, 0));

        expect(within(container).getByText('Monday, June 1')).toBeTruthy();
        expect(within(container).queryByText('Sunday, May 31')).toBeNull();
    });

    it('hydrates with NO mismatch to recover from (the stale text is not traded for hydration errors)', async () => {
        // The two clocks disagree by ten hours and two buckets. The fix must make that invisible to React —
        // both passes render the same placeholder — rather than emitting a mismatch and papering over it.
        await hydrateAt(new Date(2026, 4, 31, 14, 0, 0), new Date(2026, 4, 31, 3, 0, 0));

        expect(recovered, 'React recovered from a hydration mismatch').toEqual([]);
        expect(consoleError).not.toHaveBeenCalled();
    });

    it('makes the greeting the page’s one <h1> after hydration (slice 3: the large title IS the greeting)', async () => {
        const container = await hydrateAt(new Date(2026, 4, 31, 14, 0, 0), new Date(2026, 4, 31, 8, 0, 0));

        expect(within(container).getByRole('heading', { level: 1, name: 'Good morning' })).toBeTruthy();
    });

    it('drops the reserved placeholder once the greeting is rendered', async () => {
        const container = await hydrateAt(new Date(2026, 4, 31, 14, 0, 0), new Date(2026, 4, 31, 8, 0, 0));

        expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it('reserves the SAME line boxes it later fills, so the hero does not resize at hydration', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
        const tree = (
            <LocaleProvider locale="en">
                <HomeGreeting />
            </LocaleProvider>
        );
        const container = document.createElement('div');
        container.innerHTML = renderToString(tree);
        document.body.append(container);

        // The placeholder's two lines, captured BEFORE hydration replaces them.
        const reserved = [...container.querySelectorAll('[aria-hidden="true"] > *')].map(
            (node) => node.getAttribute('class') ?? '',
        );
        expect(reserved).toHaveLength(2);

        vi.setSystemTime(new Date(2026, 4, 31, 8, 0, 0));
        await act(async () => {
            hydrateRoot(container, tree);
        });

        // jsdom loads no Tailwind stylesheet, so a computed line-height cannot be measured here. What CAN be
        // asserted is the invariant that makes the heights equal: the placeholder line carries the real line's
        // typography utilities (`mb-1` and the type scale included) plus only its own bar shape. Drop the
        // shared class and this fails — which is exactly the drift that reintroduces the layout shift.
        const greeting = within(container).getByRole('heading', { level: 1 }).getAttribute('class') ?? '';
        const date = container.querySelector('p')?.getAttribute('class') ?? '';

        for (const utility of greeting.split(/\s+/)) {
            expect(reserved[0], `greeting placeholder is missing "${utility}"`).toContain(utility);
        }

        for (const utility of date.split(/\s+/)) {
            expect(reserved[1], `date placeholder is missing "${utility}"`).toContain(utility);
        }
    });
});
