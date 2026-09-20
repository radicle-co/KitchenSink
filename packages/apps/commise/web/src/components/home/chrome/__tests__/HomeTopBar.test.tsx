// @vitest-environment jsdom
/**
 * Component tests for the sticky Home top bar (US-000 / FR-046).
 *
 * The two decisions this bar makes over the mockup are what these lock in: the notification bell carries NO
 * fabricated count (there is no notifications feed in v1), and the avatar shows the viewer's REAL initials —
 * or, for a name-less account, a fallback glyph and no invented letters. Plus the hamburger opens the mobile
 * nav. Selectors are role/label only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { webMessages } from '@/i18n/messages';

import { HomeTopBar } from '../HomeTopBar';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

const renderTopBar = (overrides: Partial<Parameters<typeof HomeTopBar>[0]> = {}): void => {
    render(
        <HomeTopBar
            chrome={chrome}
            pageTitle={chrome.pageTitles.home}
            locale="en"
            displayName="Jane Doe"
            onOpenNav={vi.fn()}
            {...overrides}
        />,
    );
};

describe('HomeTopBar', () => {
    it('renders the CALLER-supplied page title in a banner landmark', () => {
        renderTopBar({ pageTitle: chrome.pageTitles.recipes });

        const banner = screen.getByRole('banner');
        expect(banner).toBeTruthy();
        expect(within(banner).getByText(chrome.pageTitles.recipes)).toBeTruthy();
        // The bar no longer hard-codes Home's title for every shell route.
        expect(within(banner).queryByText(chrome.pageTitles.home)).toBeNull();
    });

    /**
     * The bar's title is orientational CHROME that repeats on every route — the page's own `<main>` content
     * owns the authoritative `<h1>`. Exposing the chrome title as a heading too gave every shell route TWO
     * `h1`s, and once the title became per-route it would additionally be a SECOND heading with the SAME
     * accessible name as the page's `h1` — ambiguous for heading navigation (and for `getByRole('heading')`).
     * The `<header>` banner landmark is the structural anchor; the title inside it is plain text.
     */
    it('exposes the title as plain text, NOT as a heading (the page content owns the h1)', () => {
        renderTopBar({ pageTitle: chrome.pageTitles.recipes });

        expect(screen.queryByRole('heading')).toBeNull();
        expect(screen.queryByRole('heading', { name: chrome.pageTitles.recipes })).toBeNull();
    });

    it('exposes the search and notifications affordances by accessible name', () => {
        renderTopBar();

        expect(screen.getByRole('button', { name: chrome.search })).toBeTruthy();
        expect(screen.getByRole('button', { name: chrome.notifications })).toBeTruthy();
    });

    it('shows NO notification count — a v1 with no feed must not fabricate one', () => {
        renderTopBar();

        // The bell control (and the whole bar) must contain no digit — the mockup's "3" badge is fabricated.
        expect(screen.getByRole('button', { name: chrome.notifications }).textContent).not.toMatch(/\d/u);
        expect(screen.getByRole('banner').textContent).not.toMatch(/\d/u);
    });

    it('derives the avatar initials from the real display name', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        const account = screen.getByRole('link', { name: chrome.account });
        expect(account.textContent).toBe('JD');
        expect(account.getAttribute('href')).toBe('/en/profile');
    });

    it('falls back to a glyph (never invented initials) and a name-less accessible name when unknown', () => {
        renderTopBar({ displayName: undefined });

        // The name-less account is a real state (email sign-up). Its accessible name is the "no name"
        // variant, and it shows NO letters at all — not a guessed initial.
        const account = screen.getByRole('link', { name: chrome.accountNoName });
        expect(account.textContent).toBe('');
        expect(screen.queryByRole('link', { name: chrome.account })).toBeNull();
    });

    it('opens the mobile navigation when the hamburger is activated', async () => {
        const onOpenNav = vi.fn();
        renderTopBar({ onOpenNav });

        await userEvent.setup().click(screen.getByRole('button', { name: chrome.openNav }));

        expect(onOpenNav).toHaveBeenCalledOnce();
    });

    it('floors every icon control and the avatar to a 44px touch target at base (U5)', () => {
        renderTopBar();

        // A base `min-h-11 min-w-11` (44px) floor guarantees the mobile touch-target minimum regardless of
        // future icon/padding tweaks. The floor belongs on the CONTROL box; what it must never sit on is a
        // PAINTED box smaller than 44px — see the structural suite below, and
        // `tests/e2e/homeTopBarGeometry.spec.ts` for the pixels.
        const targets = [
            screen.getByRole('button', { name: chrome.openNav }),
            screen.getByRole('button', { name: chrome.search }),
            screen.getByRole('button', { name: chrome.notifications }),
            screen.getByRole('link', { name: chrome.account }),
        ];

        for (const target of targets) {
            expect(target.className).toContain('min-h-11');
            expect(target.className).toContain('min-w-11');
        }
    });

    /**
     * REWRITTEN by U39, which changed the behaviour this covers rather than merely renaming it.
     *
     * The `md:` reset exists to restore the mockup's 40px desktop density on controls that are STILL ON
     * SCREEN at desktop widths. The hamburger is not one of them: it is `lg:hidden` chrome, so at every width
     * it is visible the viewer is on a narrow or tablet layout and the 44px floor is the whole point. It used
     * to carry `md:min-h-0 md:min-w-0` too, which was a documented no-op only because the control also hid at
     * `md` — closing the 768–1023px navigation gap made that dead class LIVE, and it would have shrunk the
     * one navigation affordance a tablet has to 40px. The previous version of this case asserted the reset on
     * all four controls uniformly; it now asserts the two groups separately, because they are two rules.
     */
    it('releases the touch floor at md ONLY on the controls that survive to desktop', () => {
        renderTopBar();

        for (const target of [
            screen.getByRole('button', { name: chrome.search }),
            screen.getByRole('button', { name: chrome.notifications }),
            screen.getByRole('link', { name: chrome.account }),
        ]) {
            expect(target.className).toContain('md:min-h-0');
            expect(target.className).toContain('md:min-w-0');
        }

        // The hamburger keeps its floor for every width it is rendered at — including the tablet band.
        const hamburger = screen.getByRole('button', { name: chrome.openNav });
        expect(hamburger.className).not.toContain('min-h-0');
        expect(hamburger.className).not.toContain('min-w-0');
    });
});

/**
 * The avatar's STRUCTURE — the paint/hit-area split, in the only terms jsdom is authoritative about.
 *
 * ⚠️ These assertions are deliberately about STRUCTURE and CLASS STRINGS, never about pixels. jsdom runs no
 * Tailwind and computes no layout, so nothing here can measure a box. The previous version of this suite
 * tried anyway: it re-implemented the CSS box model in JavaScript (a `STEP_PX = 4` spacing ramp and a
 * `max(min-size, size)` resolver) and asserted the component against that model. It passed while production
 * painted the avatar at 64px and overflowed its own 56px bar, because the design system had redefined
 * Tailwind's `--spacing-*` namespace and the simulator's `4px per step` premise was simply false. A
 * simulator can only ever confirm its own assumptions, so it was guaranteed to miss the next theme-level
 * defect too — it was deleted rather than corrected once `themeCss` freed the namespace (21932fd2).
 *
 * The pixel facts — a 32px disc, a ≥44px control at base and 40px at `md`+, and the disc sitting wholly
 * inside the 56px `h-14` bar — are measured with real `boundingBox()` calls in a real engine by
 * `tests/e2e/homeTopBarGeometry.spec.ts`. That is the only tier that can measure them.
 */
describe('HomeTopBar — avatar structure', () => {
    /**
     * Find the element that PAINTS the avatar disc (the seafoam fill).
     *
     * @param control - The account link.
     * @returns The painted element.
     */
    const paintedDisc = (control: HTMLElement): Element => {
        const painted = control.querySelector('[class*="bg-seafoam"]');

        expect(painted, 'nothing inside the account control paints the avatar fill').not.toBeNull();

        return painted as Element;
    };

    it('paints the disc on a SEPARATE box from the control that carries the touch floor', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        const control = screen.getByRole('link', { name: chrome.account });
        const disc = paintedDisc(control);

        // The defect this split exists to prevent: `min-*` cannot lose to `height`/`width`, so a 44px floor
        // sharing a box with the 32px disc silently repaints the disc at 44px. The floor must therefore live
        // on a box that paints nothing, and the disc must carry no floor of its own.
        expect(disc).not.toBe(control);
        expect(control.className).not.toContain('bg-seafoam');
        expect(disc.className).not.toContain('min-h-');
        expect(disc.className).not.toContain('min-w-');
    });

    it('sizes the disc with a single square utility, so it cannot resolve to an ellipse', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        const disc = paintedDisc(screen.getByRole('link', { name: chrome.account }));

        // `size-8` sets both axes at once; a `h-8 w-11` pair (or a one-axis floor) would render a pill under
        // `rounded-full`. The resulting length is asserted in the browser, not here.
        expect(disc.className).toContain('size-8');
        expect(disc.className).toContain('rounded-full');
    });

    it('holds the same structure for the name-less viewer (glyph fallback)', () => {
        renderTopBar({ displayName: undefined });

        // The fallback path renders a different CHILD (a glyph, not initials) — it must not render a
        // different disc.
        const control = screen.getByRole('link', { name: chrome.accountNoName });
        const disc = paintedDisc(control);

        expect(disc).not.toBe(control);
        expect(disc.className).toContain('size-8');
        expect(control.className).toContain('min-h-11');
        expect(control.className).toContain('min-w-11');
    });

    it("renders the bar at the mockup's h-14, the height the disc must fit inside", () => {
        renderTopBar();

        // The 56px bar is the constraint the disc is measured against in the browser; that it is declared at
        // all is the part jsdom can hold.
        expect(screen.getByRole('banner').className).toContain('h-14');
    });
});
