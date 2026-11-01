'use client';

/**
 * @module @commise/ui/back-to-top — the web design-system {@link BackToTop} (see `props.ts`). It shows by
 * `backToTopPolicy` over the page's `ScrollHost`, as a secondary `sm` button with the `arrowUp` glyph at the bottom
 * trailing corner — 16 px above the floating create button where one shows — and is hidden while the keyboard is open.
 * Pressing it scrolls to the top (instant under reduced motion, the host's rule) and hands focus back to the H1. Place
 * it LAST in DOM order.
 *
 * Presentational about data: it fetches and mutates nothing; it reads the page's scroll host and the keyboard.
 *
 * @pattern Policy — `backToTopPolicy` decides, the leaf draws
 */
import type { FC } from 'react';

import { Button } from '../button/Button.js';
import { useScrollHost } from '../scrollHost/scrollHostContext.js';
import { useKeyboardOpen } from '../screenEnvironment/useKeyboardOpen.js';
import { showsBackToTop } from './backToTopPolicy.js';
import type { BackToTopProps } from './props.js';

/** The web design-system "Back to top". */
export const BackToTop: FC<BackToTopProps> = ({ label, onReturn, aboveFab = false }) => {
    const host = useScrollHost();
    const keyboardOpen = useKeyboardOpen();
    const shows = showsBackToTop({
        pageViewports: host.pageViewports,
        viewportsDown: host.viewportsDown,
        scrollingUp: !host.scrollingDown,
        keyboardOpen,
    });

    if (!shows) {
        return null;
    }

    return (
        <div
            className={`fixed end-4 z-40 ${
                aboveFab
                    ? // On the room the floating button reserves (its height, its margin and 16), above the same bottom
                      // chrome; from 840 there is no floating button, so it rests at the button's margin.
                      'bottom-[calc(var(--bottom-chrome,0px)+var(--fab-reserved-bottom))] ' +
                      'nav:bottom-[calc(var(--bottom-chrome,0px)+var(--fab-bottom-margin))]'
                    : 'bottom-[calc(var(--bottom-chrome,0px)+var(--fab-bottom-margin))]'
            }`}
        >
            <Button
                variant="secondary"
                size="sm"
                icon="arrowUp"
                onPress={() => {
                    host.scrollToTop();
                    onReturn();
                }}
            >
                {label}
            </Button>
        </div>
    );
};
