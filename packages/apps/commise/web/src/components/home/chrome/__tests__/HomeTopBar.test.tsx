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

    it('floors every icon control and the avatar to a 44px touch target at base, reset at md (U5)', () => {
        renderTopBar();

        // A base `min-h-11 min-w-11` (44px) floor guarantees the mobile touch-target minimum regardless of
        // future icon/padding tweaks, reset to `md:min-h-0 md:min-w-0` so desktop density is untouched. The
        // floor belongs on the CONTROL box; what it must never sit on is a PAINTED box smaller than 44px —
        // see the avatar-geometry suite below for why that distinction is load-bearing.
        const targets = [
            screen.getByRole('button', { name: chrome.openNav }),
            screen.getByRole('button', { name: chrome.search }),
            screen.getByRole('button', { name: chrome.notifications }),
            screen.getByRole('link', { name: chrome.account }),
        ];

        for (const target of targets) {
            expect(target.className).toContain('min-h-11');
            expect(target.className).toContain('min-w-11');
            expect(target.className).toContain('md:min-h-0');
            expect(target.className).toContain('md:min-w-0');
        }
    });
});

/**
 * The avatar's GEOMETRY, asserted in pixels rather than in class names.
 *
 * jsdom runs no Tailwind and computes no layout, so `getComputedStyle` here reports nothing useful — the
 * pixel facts live in the utility classes. These helpers resolve the classes that are actually present into
 * the box CSS would produce, so the assertions below are about 32px vs 44px, not about which strings appear.
 *
 * Tailwind's spacing ramp is 4px per step (`size-8` → 32px, `min-h-11` → 44px, `h-14` → 56px), the same 4px
 * base as `@commise/ui`'s `spacing` scale.
 */
const STEP_PX = 4;

/**
 * Resolve one base-breakpoint sizing utility to pixels.
 *
 * @param className - The element's full class attribute.
 * @param prefix - The utility prefix (`size`, `h`, `w`, `min-h`, `min-w`).
 * @returns The declared length in px, or `undefined` when the utility is absent. Responsive variants
 *   (`md:min-h-0`) are deliberately ignored: the defect being pinned is the BASE (phone) geometry.
 */
const declaredPx = (className: string, prefix: string): number | undefined => {
    const match = new RegExp(String.raw`(?:^|\s)${prefix}-(\d+(?:\.5)?)(?:\s|$)`, 'u').exec(className);

    return match?.[1] === undefined ? undefined : Number.parseFloat(match[1]) * STEP_PX;
};

/**
 * The box CSS would USE for an element, per axis — `max(min-size, size)`.
 *
 * This is the rule the bug rode in on: a `min-h-11`/`min-w-11` touch floor on the same box as `size-8`
 * cannot lose to it, so the 32px avatar painted as a 44px disc.
 *
 * @param element - The element to measure.
 * @returns Its used width/height in px. An axis with no declared size falls back to its floor (a
 *   content-sized box can only be pinned by its floor here).
 */
const usedBox = (element: Element): { readonly widthPx: number; readonly heightPx: number } => {
    const className = element.className;
    const size = declaredPx(className, 'size');
    const widthFloor = declaredPx(className, 'min-w') ?? 0;
    const heightFloor = declaredPx(className, 'min-h') ?? 0;

    return {
        widthPx: Math.max(size ?? declaredPx(className, 'w') ?? 0, widthFloor),
        heightPx: Math.max(size ?? declaredPx(className, 'h') ?? 0, heightFloor),
    };
};

/** The mockup's avatar disc (`screen-home`: `w-8 h-8 bg-seafoam rounded-full`). */
const AVATAR_DIAMETER_PX = 32;

/** The 44px mobile touch-target floor (U5 / RC-3). */
const TOUCH_TARGET_PX = 44;

/** The breathing room the disc must leave above AND below itself inside the bar. */
const MIN_BREATHING_PX = 8;

describe('HomeTopBar — avatar geometry', () => {
    /**
     * Find the element that PAINTS the avatar disc (the seafoam fill), which is not necessarily the control.
     *
     * @param control - The account link.
     * @returns The painted element.
     */
    const paintedDisc = (control: HTMLElement): Element => {
        const painted = control.className.includes('bg-seafoam')
            ? control
            : control.querySelector('[class*="bg-seafoam"]');

        expect(painted, 'nothing in the account control paints the avatar fill').not.toBeNull();

        return painted as Element;
    };

    it('paints a 32px disc — the touch floor must not inflate the PAINTED box', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        const disc = usedBox(paintedDisc(screen.getByRole('link', { name: chrome.account })));

        // `min-*` beats `height`/`width` in CSS, so a 44px floor on the painted box silently replaces the
        // mockup's 32px disc with a 44px one. The floor belongs on a transparent parent instead.
        expect(disc.heightPx).toBe(AVATAR_DIAMETER_PX);
        expect(disc.widthPx).toBe(AVATAR_DIAMETER_PX);
    });

    it('paints a CIRCLE, not an ellipse (both axes resolve to the same length)', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        // Flooring one axis only (e.g. `min-h-11` without `min-w-11`) yields a 32×44 pill under
        // `rounded-full`; the disc must stay square on both axes.
        const disc = usedBox(paintedDisc(screen.getByRole('link', { name: chrome.account })));

        expect(disc.heightPx).toBe(disc.widthPx);
    });

    it('fits inside the h-14 bar with breathing room above and below', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        const bar = screen.getByRole('banner');
        const barHeightPx = declaredPx(bar.className, 'h');
        const disc = usedBox(paintedDisc(screen.getByRole('link', { name: chrome.account })));

        expect(barHeightPx).toBe(56);
        // 56 − 32 = 24px of bar, i.e. 12px above and below. A 44px disc leaves 6px and reads as a circle
        // bursting out of the bar.
        expect((barHeightPx ?? 0) - disc.heightPx).toBeGreaterThanOrEqual(2 * MIN_BREATHING_PX);
    });

    it('keeps the 44px touch target on the CONTROL while the disc shrinks', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        // Separating paint from hit area must not cost the tap target: the link keeps the floor.
        const control = usedBox(screen.getByRole('link', { name: chrome.account }));

        expect(control.heightPx).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
        expect(control.widthPx).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    });

    it('holds the same geometry for the name-less viewer (glyph fallback)', () => {
        renderTopBar({ displayName: undefined });

        // The fallback path renders a different child (a glyph, not initials) — it must not render a
        // different disc.
        const control = screen.getByRole('link', { name: chrome.accountNoName });
        const disc = usedBox(paintedDisc(control));

        expect(disc.heightPx).toBe(AVATAR_DIAMETER_PX);
        expect(disc.widthPx).toBe(AVATAR_DIAMETER_PX);
        expect(usedBox(control).heightPx).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    });
});
