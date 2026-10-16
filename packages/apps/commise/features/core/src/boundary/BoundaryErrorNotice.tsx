/**
 * @module @commise/features-core/boundary — `BoundaryErrorNotice`: what either app shows in place of a view that threw
 * while rendering. The design system's `StateNotice` with the shared title and action labels, so the web `error.tsx`
 * boundaries and the mobile screen boundary say the same thing the same way. It is ONE file: `StateNotice` is a platform
 * pair, so the bundler gives each app its own layout.
 *
 * Two ways out, in priority order. **Try again** re-renders the crashed view (the app's boundary also resets TanStack's
 * query errors, so a failed read refetches rather than re-throwing its cached failure). **Back to Home** leaves a view
 * whose crash is not transient; the app gives none when Home is what crashed, where it would do exactly what Try again
 * does.
 *
 * Reporting stays in the app's boundary: this is the presentational half.
 *
 * @pattern Adapter over the design system's `StateNotice` — fixes its title and labels to the boundary's copy
 */
import { useMessages } from '@commise/i18n/react';
import { StateNotice } from '@commise/ui/state-notice';
import type { FC } from 'react';

import { boundaryMessages } from './messages.js';

/** Props for {@link BoundaryErrorNotice}. */
export interface BoundaryErrorNoticeProps {
    /** Why, in the app’s words (a page or a screen; whether Home is on offer). */
    readonly body: string;
    /** Try again. */
    readonly onRetry: () => void;
    /** Leave the crashed view for Home. Absent when Home itself crashed. */
    readonly onBackToHome?: () => void;
}

/** The crash fallback: presentational, props → JSX. */
export const BoundaryErrorNotice: FC<BoundaryErrorNoticeProps> = ({ body, onRetry, onBackToHome }) => {
    const copy = useMessages(boundaryMessages);

    return (
        <StateNotice
            title={copy.errorTitle}
            body={body}
            primary={{ label: copy.retry, icon: 'refreshCw', onPress: onRetry }}
            {...(onBackToHome === undefined
                ? {}
                : { secondary: { label: copy.backToHome, icon: 'house', onPress: onBackToHome } })}
        />
    );
};
