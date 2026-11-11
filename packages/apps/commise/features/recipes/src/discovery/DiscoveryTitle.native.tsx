/**
 * @module @commise/features-recipes — the native discovery page's large title (`buildSpec.md` §3.3), which carries no
 * avatar (owner ruling 2026-11-11, N3). The one place the title is drawn, for the stacked header and the panel layout.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import type { FC } from 'react';

import { discoveryMessages } from './messages.js';
import { DISCOVER_TITLE_ID } from './model.js';

/** Props for {@link DiscoveryTitle}. */
export interface DiscoveryTitleProps {
    /** Advances when a refresh retry succeeds; the heading takes the screen-reader cursor. */
    readonly focusSignal: number;
}

/** The native discovery title. */
export const DiscoveryTitle: FC<DiscoveryTitleProps> = ({ focusSignal }) => {
    const discovery = useMessages(discoveryMessages);

    return <LargeTitleHeader headingId={DISCOVER_TITLE_ID} title={discovery.heading} focusSignal={focusSignal} />;
};
