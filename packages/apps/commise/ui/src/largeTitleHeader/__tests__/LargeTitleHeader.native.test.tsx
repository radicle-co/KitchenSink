/**
 * The native LargeTitleHeader (buildSpec §3.3): the H1 is a header in `largeTitle`, read BEFORE the avatar and the
 * floating button; the back control is named "Back to {parent}"; inside a ScrollHost the title block reports its layout
 * so the host can condense; and a screen-reader focus signal moves the cursor to it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Pressable, Text } from 'react-native';

import { ScrollHost } from '../../scrollHost/ScrollHost.native.js';
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
