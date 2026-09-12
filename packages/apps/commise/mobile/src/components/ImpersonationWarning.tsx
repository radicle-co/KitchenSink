/**
 * @module components/ImpersonationWarning — the mobile impersonation-unavailable notice.
 *
 * Administrator impersonation is deliberately not supported in the app, so the viewer is told why instead of
 * being left at a dead end. Renders the shared {@link AlertBanner} in the caution tone.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { JSX } from 'react';

import { mobileMessages } from '../i18n/messages';
import { AlertBanner } from './AlertBanner';

/** Props for {@link ImpersonationWarning}. */
interface ImpersonationWarningProps {
    /** The impersonated session's id, appended for support correlation when known. */
    readonly sessionId?: string;
}

/**
 * The impersonation-unavailable notice.
 *
 * @param props - The optional impersonated `sessionId`.
 * @returns The caution banner.
 */
export function ImpersonationWarning({ sessionId }: ImpersonationWarningProps): JSX.Element {
    const { impersonation } = useMessages(mobileMessages);
    // The session id is appended through the localized template — never concatenated as English.
    const body =
        sessionId === undefined
            ? impersonation.message
            : `${impersonation.message} ${impersonation.sessionLabel.replace('{sessionId}', sessionId)}`;

    return <AlertBanner accent={palette.warning} title={impersonation.title} body={body} />;
}
