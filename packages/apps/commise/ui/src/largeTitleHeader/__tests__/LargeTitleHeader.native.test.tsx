/**
 * The native LargeTitleHeader (buildSpec §3.3): the H1 is a header in `largeTitle`, read BEFORE the avatar and the
 * floating button; the back control is named "Back to {parent}"; inside a ScrollHost the title block reports its layout
 * so the host can condense; and a screen-reader focus signal moves the cursor to it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { Pressable, Text } from 'react-native';

import { ScrollHost } from '../../scrollHost/ScrollHost.native.js';
import { renderWithTamagui, render, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { nativeTokens } from '../../tokens/native.js';
import { useScrollHost } from '../../scrollHost/scrollHostContext.js';
import { LargeTitleHeader } from '../LargeTitleHeader.native.js';

afterEach(cleanup);

describe('LargeTitleHeader (native)', () => {
    it('renders the title as a header, read before the avatar and the floating button', () => {
        render(
            <LargeTitleHeader
                headingId="h"
                title="Recipes"
                action={{
                    kind: 'avatar',
                    avatar: (
                        <Pressable accessibilityRole="button" accessibilityLabel="Profile">
                            <Text>E</Text>
                        </Pressable>
                    ),
                }}
                afterTitle={
                    <Pressable accessibilityRole="button" accessibilityLabel="New recipe">
                        <Text>+</Text>
                    </Pressable>
                }
            />,
        );

        const heading = screen.getByRole('heading', { name: 'Recipes' });
        const avatar = screen.getByRole('button', { name: 'Profile' });
        const fab = screen.getByRole('button', { name: 'New recipe' });

        expect(heading.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(avatar.compareDocumentPosition(fab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // Pinned back bar (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §4 "No duplicate"). REWRITES the old "names the
    // back control "Back to {parent}" and calls it" test: on native the pinned `CondensedTitleBar` owns Back, and a header
    // that also drew one left a second element with the same name, scrolled off screen but still in the tree. The prop
    // stays (web uses it for the 840+ eyebrow); native simply draws nothing for it.
    it('renders no Back control, even when given a back: the pinned bar owns it', () => {
        render(
            <LargeTitleHeader
                headingId="h"
                title="Weeknight dinners"
                back={{ label: 'Back to Collections', parent: 'Collections', onPress: vi.fn() }}
            />,
        );

        expect(screen.queryAllByRole('button', { name: 'Back to Collections', hidden: true })).toHaveLength(0);
        expect(screen.getByRole('heading', { name: 'Weeknight dinners' })).toBeTruthy();
    });

    it('draws its 44 pt row for an action and for nothing else', () => {
        const { rerender } = render(
            <LargeTitleHeader
                headingId="h"
                title="Weeknight dinners"
                back={{ label: 'Back to Collections', parent: 'Collections', onPress: vi.fn() }}
            />,
        );
        const titleBlock = (): HTMLElement => screen.getByRole('heading', { name: 'Weeknight dinners' }).parentElement!;

        expect(getComputedStyle(titleBlock()).paddingTop).not.toBe('44px');

        rerender(
            <LargeTitleHeader
                headingId="h"
                title="Weeknight dinners"
                action={{ kind: 'controls', menu: <Text>more</Text> }}
            />,
        );

        expect(getComputedStyle(titleBlock()).paddingTop).toBe('44px');
    });

    // Bug sweep (pagesDesignerB, component item): a screen that forgot to pad put the title on the screen edge, so the
    // inset belongs to the header. The action is absolutely placed, which ignores the parent's padding, so it carries
    // the same inset itself: otherwise it would sit on the edge the title just left.
    it('insets its own content 16 pt from each side, so a screen need not pad it', () => {
        render(
            <LargeTitleHeader
                headingId="h"
                title="Recipes"
                subtitle="12 recipes"
                action={{ kind: 'controls', menu: <Text>more</Text> }}
            />,
        );
        const header = screen.getByRole('heading', { name: 'Recipes' }).parentElement!.parentElement!;
        const action = screen.getByText('more').parentElement!;

        expect(getComputedStyle(header).paddingLeft).toBe('16px');
        expect(getComputedStyle(header).paddingRight).toBe('16px');
        expect(getComputedStyle(action).right).toBe('16px');
    });

    // Designer review (deviceShots2.md, 2026-11-01): at accessibility sizes Home's date read "Sunday, November...". The
    // subtitle is a fact the cook reads, so it wraps onto more lines and is never cut off.
    it('wraps a long subtitle instead of cutting it off', () => {
        render(<LargeTitleHeader headingId="h" title="Good afternoon" subtitle="Sunday, November 1, 2026" />);

        const subtitle = screen.getByText('Sunday, November 1, 2026');

        expect(getComputedStyle(subtitle).whiteSpace).not.toBe('nowrap');
        expect(getComputedStyle(subtitle).textOverflow).not.toBe('ellipsis');
        expect(getComputedStyle(subtitle).getPropertyValue('-webkit-line-clamp')).toBe('');
    });

    // Once it wraps, its leading must grow with its size, or Android draws the lines over each other (ADR-0080 §8,
    // H-1). The design-system Text in the meta role grows both together, to the 2× cap.
    it('draws the subtitle in the meta role, size and leading grown together', () => {
        const { fontSize, lineHeight } = nativeTokens.type.meta;

        renderWithTamagui(
            <LargeTitleHeader headingId="h" title="Good afternoon" subtitle="Sunday, November 1, 2026" />,
            'light',
            3.1,
        );

        const subtitle = screen.getByText('Sunday, November 1, 2026');

        expect(getComputedStyle(subtitle).fontSize).toBe(`${String(fontSize * 2)}px`);
        expect(getComputedStyle(subtitle).lineHeight).toBe(`${String(lineHeight * 2)}px`);
    });

    it('reports the title block’s layout to its ScrollHost, which then condenses past it', () => {
        const seen: { condensed?: boolean; scroll?: (y: number) => void } = {};

        const Probe = (): null => {
            seen.condensed = useScrollHost().condensed;

            return null;
        };

        const { container } = render(
            <ScrollHost>
                {(bind) => {
                    seen.scroll = (y) =>
                        bind.onScroll({
                            nativeEvent: {
                                contentOffset: { y },
                                layoutMeasurement: { height: 800 },
                                contentSize: { height: 4000 },
                            },
                        });

                    return (
                        <>
                            <LargeTitleHeader headingId="h" title="Recipes" />
                            <Probe />
                        </>
                    );
                }}
            </ScrollHost>,
        );

        // react-native-web delivers `onLayout` from a ResizeObserver jsdom lacks; it stores the handler on the node as
        // `__reactLayoutHandler`, so the test calls it as the observer would: the title block is 44 pt down, 40 tall.
        const titleBlock = screen.getByRole('heading', { name: 'Recipes' }).parentElement as
            (HTMLElement & { __reactLayoutHandler?: (event: unknown) => void }) | null;

        expect(container.contains(titleBlock)).toBe(true);
        act(() => titleBlock?.__reactLayoutHandler?.({ nativeEvent: { layout: { y: 44, height: 40 } } }));
        act(() => seen.scroll?.(83));
        expect(seen.condensed).toBe(false);
        act(() => seen.scroll?.(84));
        expect(seen.condensed).toBe(true);
    });
});

// Designer finding C-1 (reviews/mergedUiIos1.md): at the largest text size the title drew at about 3x and broke inside its
// word ("Recipe / s"). `largeTitle` stops at 1.5x (42 pt), a capped title fits whole words at 390 pt (the fit is
// `recipesScreen.fit.test.ts`).
describe('LargeTitleHeader (native) — the title stops at 1.5x', () => {
    it.each([
        [1, '28px'],
        [1.5, '42px'],
        [2, '42px'],
        [3.1, '42px'],
    ] as const)('at system scale %fx the title is %s', (scale, size) => {
        renderWithTamagui(<LargeTitleHeader headingId="h" title="Recipes" />, 'light', scale);

        expect(resolvedStyle(screen.getByRole('heading', { name: 'Recipes' }), 'fontSize')).toBe(size);
    });
});
