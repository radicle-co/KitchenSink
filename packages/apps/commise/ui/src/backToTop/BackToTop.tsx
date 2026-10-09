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
                    ? // The floating button's 56 px plus 16 px between them, above the same bottom chrome.
                      'bottom-[calc(var(--bottom-chrome,0px)+5.5rem)] nav:bottom-[calc(var(--bottom-chrome,0px)+1rem)]'
                    : 'bottom-[calc(var(--bottom-chrome,0px)+1rem)]'
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
