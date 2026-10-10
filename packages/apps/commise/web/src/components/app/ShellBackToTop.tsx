'use client';

/**
 * @module components/app/ShellBackToTop — web's "Back to top" on a long list page (`buildSpec.md` §3.6): the
 * design-system `BackToTop` with the shell's copy, handing focus back to the page's H1 once it has scrolled. A page
 * places it LAST inside its `AppShell`, so it is last in DOM order. Web only: native's job is the tab re-tap.
 *
 * ORCHESTRATION: it binds the shell's copy and the H1 focus move to the design-system control.
 *
 * @pattern Adapter over `@commise/ui/back-to-top`
 */
import { useMessages } from '@commise/i18n/react';
import { BackToTop } from '@commise/ui/back-to-top';
import type { JSX } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link ShellBackToTop}. */
export interface ShellBackToTopProps {
    /** Whether the page floats a create button, which "Back to top" then sits above. */
    readonly aboveFab?: boolean;
}

/**
 * @param props - Whether the page floats a create button.
 * @returns The page's "Back to top".
 */
export function ShellBackToTop({ aboveFab = false }: ShellBackToTopProps): JSX.Element {
    const { home } = useMessages(webMessages);

    return (
        <BackToTop
            label={home.chrome.backToTop}
            aboveFab={aboveFab}
            // @sideEffect The page's one H1 takes focus, so a keyboard or screen-reader user lands at the top too.
            onReturn={() => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })}
        />
    );
}
