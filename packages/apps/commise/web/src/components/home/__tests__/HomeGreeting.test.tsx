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

import { LocaleProvider } from '@commise/i18n/react';
import { renderWithProviders } from '@commise/test-utils';

import { webMessages } from '@/i18n/messages';

import { HomeGreeting } from '../HomeGreeting';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** Render the greeting with the clock frozen at a fixed LOCAL instant. */
const renderAt = (year: number, monthIndex: number, day: number, hour: number, locale = 'en'): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, monthIndex, day, hour, 0, 0));

    renderWithProviders(<HomeGreeting />, { locale });
};

/** Every greeting string the dictionary can produce — used to assert that NO bucket leaks into the SSR pass. */
const EVERY_GREETING: readonly string[] = Object.values(webMessages.en.home.greetings);

describe('HomeGreeting (web) — time-of-day bucket', () => {
    // Each row is [hour, expected greeting]. The boundary hours (5, 12, 17, 22) are chosen on purpose: they
    // are where the bucket flips, so an off-by-one in the shared bucketer is caught here.
    it.each([
        [8, 'Good morning, Chef!'],
        [5, 'Good morning, Chef!'],
        [14, 'Good afternoon, Chef!'],
        [12, 'Good afternoon, Chef!'],
        [19, 'Good evening, Chef!'],
        [17, 'Good evening, Chef!'],
        [23, 'Still up, Chef?'],
        [2, 'Still up, Chef?'],
    ])('at hour %i greets "%s"', (hour, expected) => {
        renderAt(2026, 4, 31, hour);

        expect(screen.getByRole('heading', { name: expected })).toBeTruthy();
    });
});

describe('HomeGreeting (web) — date subtitle', () => {
    it('renders the local calendar date in the mockup long form', () => {
        // 2026-05-31 is a Sunday (the mockup label "Saturday" was fictional copy).
        renderAt(2026, 4, 31, 14);

        expect(screen.getByText('Sunday, May 31, 2026')).toBeTruthy();
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

        expect(html).not.toContain('May 31, 2026');
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
        [14, 8, 'Good morning, Chef!'],
        [2, 14, 'Good afternoon, Chef!'],
        [8, 19, 'Good evening, Chef!'],
        [14, 3, 'Still up, Chef?'],
    ])('server hour %i, client hour %i → greets "%s"', async (serverHour, clientHour, expected) => {
        const container = await hydrateAt(new Date(2026, 4, 31, serverHour, 0, 0), new Date(2026, 4, 31, clientHour));

        expect(within(container).getByRole('heading', { name: expected })).toBeTruthy();
    });

    it('shows only the client bucket — the server’s greeting is gone, not merely joined', async () => {
        const container = await hydrateAt(new Date(2026, 4, 31, 14, 0, 0), new Date(2026, 4, 31, 3, 0, 0));

        expect(within(container).getByRole('heading', { name: 'Still up, Chef?' })).toBeTruthy();
        expect(within(container).queryByText('Good afternoon, Chef!')).toBeNull();
    });

    it('renders the CLIENT’s calendar day, not the server’s (a viewer past midnight is on tomorrow)', async () => {
        // The server is still on May 31; the viewer's own clock has already turned over to June 1.
        const container = await hydrateAt(new Date(2026, 4, 31, 22, 0, 0), new Date(2026, 5, 1, 3, 0, 0));

        expect(within(container).getByText('Monday, June 1, 2026')).toBeTruthy();
        expect(within(container).queryByText('Sunday, May 31, 2026')).toBeNull();
    });

    it('hydrates with NO mismatch to recover from (the stale text is not traded for hydration errors)', async () => {
        // The two clocks disagree by ten hours and two buckets. The fix must make that invisible to React —
        // both passes render the same placeholder — rather than emitting a mismatch and papering over it.
        await hydrateAt(new Date(2026, 4, 31, 14, 0, 0), new Date(2026, 4, 31, 3, 0, 0));

        expect(recovered, 'React recovered from a hydration mismatch').toEqual([]);
        expect(consoleError).not.toHaveBeenCalled();
    });

    it('keeps the greeting an <h2> under the page’s <h1> after hydration', async () => {
        const container = await hydrateAt(new Date(2026, 4, 31, 14, 0, 0), new Date(2026, 4, 31, 8, 0, 0));

        // The heading LEVEL is load-bearing: Home's own <h1> is the sr-only page title, so the greeting must
        // stay level 2 or the document outline breaks.
        expect(within(container).getByRole('heading', { level: 2, name: 'Good morning, Chef!' })).toBeTruthy();
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
        const greeting = within(container).getByRole('heading', { level: 2 }).getAttribute('class') ?? '';
        const date = container.querySelector('p')?.getAttribute('class') ?? '';

        for (const utility of greeting.split(/\s+/)) {
            expect(reserved[0], `greeting placeholder is missing "${utility}"`).toContain(utility);
        }

        for (const utility of date.split(/\s+/)) {
            expect(reserved[1], `date placeholder is missing "${utility}"`).toContain(utility);
        }
    });
});
