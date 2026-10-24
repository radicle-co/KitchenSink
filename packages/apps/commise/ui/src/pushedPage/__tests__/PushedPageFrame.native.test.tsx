/**
 * The native PushedPageFrame (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §2, §5, §7): the one frame a pushed page
 * mounts. It owns the page's ONE `ScrollHost`, lays the pinned `CondensedTitleBar` over the scroller, and hands the page
 * its `bind`. Back is pinned at every scroll position and in every state; exactly ONE element carries the name
 * "Back to {parent}", counted with `hidden: true` because a hidden duplicate is the defect this removes; Back comes
 * before the H1 in tree order; the iOS two-finger escape gesture goes back.
 *
 * Section 5's states, in order: the top of the page, content under the bar with the H1 still visible, the H1 under the
 * bar, a page that does not scroll, and loading (no title). The photo state is R3's and is not built.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Text } from 'react-native';

const escape = vi.hoisted(() => ({ handler: undefined as (() => void) | undefined }));

// react-native-web drops `onAccessibilityEscape` (an iOS-only prop) before the DOM, so the test captures it where the
// frame sets it: on the View. Every other View passes through untouched.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { createElement } = await import('react');

    return {
        ...actual,
        View: (props: Record<string, unknown>) => {
            if (typeof props['onAccessibilityEscape'] === 'function') {
                escape.handler = props['onAccessibilityEscape'] as () => void;
            }

            return createElement(actual.View, props);
        },
    };
});

import { role } from '../../tokens/colors.js';
import { rgb } from '../../testing/systemColorScheme.js';
import { LargeTitleHeader } from '../../largeTitleHeader/LargeTitleHeader.native.js';
import { PushedPageFrame } from '../PushedPageFrame.native.js';
import { PINNED_BAR_HEIGHT } from '../../largeTitleHeader/barGeometry.js';

afterEach(() => {
    cleanup();
    escape.handler = undefined;
});

const BACK = { label: 'Back to Profile', parent: 'Profile', onPress: () => undefined };

/** Scroll a bind's scroller to y, the way a ScrollView would report it. */
const scrollTo = (bind: { onScroll: (event: never) => void }, y: number): void =>
    bind.onScroll({
        nativeEvent: {
            contentOffset: { y },
            layoutMeasurement: { height: 800 },
            contentSize: { height: 4000 },
        },
    } as never);

/** A page whose H1 reports a 40 pt title block at y 0, as the header does inside the scroller. */
function renderPage(props: { title?: string; onPress?: () => void } = {}) {
    const seen: { bind?: Parameters<typeof scrollTo>[0] } = {};
    const back = { ...BACK, ...(props.onPress === undefined ? {} : { onPress: props.onPress }) };

    render(
        <PushedPageFrame back={back} headingId="h" {...(props.title === undefined ? {} : { title: props.title })}>
            {(bind) => {
                seen.bind = bind as unknown as Parameters<typeof scrollTo>[0];

                return <LargeTitleHeader headingId="h" title="Profile settings" />;
            }}
        </PushedPageFrame>,
    );

    const titleBlock = screen.getByRole('heading', { name: 'Profile settings' }).parentElement as
        (HTMLElement & { __reactLayoutHandler?: (event: unknown) => void }) | null;
    act(() => titleBlock?.__reactLayoutHandler?.({ nativeEvent: { layout: { y: 0, height: 40 } } }));

    return {
        scroll: (y: number) => act(() => scrollTo(seen.bind!, y)),
        barTitle: () =>
            screen.queryAllByText(props.title ?? '\u0000').find((n) => n.getAttribute('aria-hidden') === 'true'),
    };
}

const backs = () => screen.getAllByRole('button', { name: 'Back to Profile', hidden: true });

describe('PushedPageFrame (native) — the content inset', () => {
    it('hands the page the inset that starts it under the bar, beside the scroller’s bind, so no page restates it', () => {
        let received: unknown;

        render(
            <PushedPageFrame back={BACK} headingId="h">
                {(_bind, inset) => {
                    received = inset;

                    return <Text>Page</Text>;
                }}
            </PushedPageFrame>,
        );

        expect(received).toEqual({ paddingTop: PINNED_BAR_HEIGHT });
    });
});

describe('PushedPageFrame (native)', () => {
    it('top of the page: Back, and no title', () => {
        const page = renderPage({ title: 'Profile' });

        expect(backs()).toHaveLength(1);
        expect(getComputedStyle(page.barTitle()!).opacity).toBe('0');
    });

    it.each([0, 10, 39, 40, 400, 3000])('has exactly one Back at scroll position %d', (y) => {
        const page = renderPage({ title: 'Profile' });

        page.scroll(y);

        expect(backs()).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Back to Profile' })).toBeTruthy();
    });

    it('scrolled with the H1 still visible: the material shows and the title does not', () => {
        const page = renderPage({ title: 'Profile' });

        page.scroll(10);

        expect(getComputedStyle(page.barTitle()!).opacity).toBe('0');
        // The material is the first child of the bar: a solid fill once shown (no glass in the test).
        const bar = screen.getByRole('button', { name: 'Back to Profile' }).parentElement as HTMLElement;
        expect(getComputedStyle(bar.firstElementChild as HTMLElement).backgroundColor).toBe(rgb(role.paperRaised));
    });

    it('the H1 under the bar: the title shows too, one line, hidden from assistive tech', () => {
        const page = renderPage({ title: 'Profile' });

        page.scroll(40);

        expect(getComputedStyle(page.barTitle()!).opacity).toBe('1');
    });

    it('a page that does not scroll stays in the top-of-page look: it never gains material or a title', () => {
        const page = renderPage({ title: 'Profile' });
        const bar = screen.getByRole('button', { name: 'Back to Profile' }).parentElement as HTMLElement;

        expect(getComputedStyle(bar.firstElementChild as HTMLElement).backgroundColor).not.toBe(rgb(role.paperRaised));
        expect(getComputedStyle(page.barTitle()!).opacity).toBe('0');
    });

    it('loading: Back with no title', () => {
        const { container } = render(
            <PushedPageFrame back={BACK} headingId="h">
                {() => <Text>Loading</Text>}
            </PushedPageFrame>,
        );

        expect(backs()).toHaveLength(1);
        expect(container.textContent).toBe('Loading');
    });

    it('calls the page’s back when Back is pressed, at the top and after a scroll', () => {
        const onPress = vi.fn();
        const page = renderPage({ title: 'Profile', onPress });

        fireEvent.click(screen.getByRole('button', { name: 'Back to Profile' }));
        page.scroll(3000);
        fireEvent.click(screen.getByRole('button', { name: 'Back to Profile' }));

        expect(onPress).toHaveBeenCalledTimes(2);
    });

    it('puts Back before the H1 in tree order, so the reading order matches the screen', () => {
        renderPage({ title: 'Profile' });
        const back = screen.getByRole('button', { name: 'Back to Profile' });
        const heading = screen.getByRole('heading', { name: 'Profile settings' });

        expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('binds the VoiceOver two-finger escape to Back', () => {
        const onPress = vi.fn();
        renderPage({ title: 'Profile', onPress });

        expect(escape.handler).toBeDefined();
        escape.handler?.();

        expect(onPress).toHaveBeenCalledOnce();
    });
});
