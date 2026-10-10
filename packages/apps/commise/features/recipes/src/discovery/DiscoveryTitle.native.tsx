/**
 * @module @commise/features-recipes — the native discovery page's large title with the app's action (the avatar, which
 * opens Profile): `buildSpec.md` §3.3. The one place the title is drawn, for the stacked header and the panel layout.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import type { FC } from 'react';

import { discoveryMessages } from './messages.js';
import { DISCOVER_TITLE_ID, type RecipeDiscoveryFrameProps } from './model.js';

/** Props for {@link DiscoveryTitle}. */
export interface DiscoveryTitleProps {
    /** Advances when a refresh retry succeeds; the heading takes the screen-reader cursor. */
    readonly focusSignal: number;
    /** The title's action, when the app supplies one. */
    readonly action: RecipeDiscoveryFrameProps['headerAction'];
}

/** The native discovery title. */
export const DiscoveryTitle: FC<DiscoveryTitleProps> = ({ focusSignal, action }) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <LargeTitleHeader
            headingId={DISCOVER_TITLE_ID}
            title={discovery.heading}
            focusSignal={focusSignal}
            {...(action === undefined ? {} : { action })}
        />
    );
};
