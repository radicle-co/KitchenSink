'use client';

/**
 * @module @commise/features-account/profile/ProfileHeader — the Profile page's identity block (web): a 72 px avatar
 * disc and the display name. A cook with no display name sees their @username there instead (owner ruling T8,
 * 2026-10-29); with neither, only the avatar. The email is NOT here: the read-only username and email show in the
 * Account group (`ProfileAccountGroup`), and the header repeats the username only when there is no name to show (owner
 * ruling S2, 2026-10-27).
 *
 * Three states, never a blocked page: loading is a skeleton (the groups under it still render), ready is the avatar and
 * the name, and failed shows the `user` glyph and says so with a Try again control. The page never invents a name.
 *
 * @pattern Visitor — an exhaustive switch over the profile read's three states
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { profileMessages } from './messages.js';
import { profileHeaderTitleOf } from './model.js';
import type { ProfileHeaderProps } from './props.js';

/** The 72 px disc. Initials sit on `action` (4.67:1 with the white label); the glyph on the quiet fill. */
const DISC = 'flex size-18 shrink-0 items-center justify-center rounded-full';

/** The identity block. */
export const ProfileHeader: FC<ProfileHeaderProps> = ({ read, initials, onRetry }) => {
    const t = useMessages(profileMessages);

    switch (read.status) {
        case 'loading':
            return (
                <div role="status" aria-label={t.loading} className="flex items-center gap-4">
                    <span aria-hidden="true" className={`${DISC} bg-surface-muted`} />
                    <span aria-hidden="true" className="h-5 w-40 rounded-sm bg-surface-muted" />
                </div>
            );
        case 'failed':
            return (
                <div className="flex items-center gap-4">
                    <span aria-hidden="true" className={`${DISC} bg-surface-muted text-ink-muted`}>
                        <Icon name="user" size={24} />
                    </span>
                    <div className="flex min-w-0 flex-col items-start gap-2">
                        <p role="alert" className="text-body text-ink">
                            {t.loadError}
                        </p>
                        <Button variant="quiet" icon="refreshCw" onPress={onRetry}>
                            {t.retry}
                        </Button>
                    </div>
                </div>
            );

        case 'ready': {
            const title = profileHeaderTitleOf(read, t.usernameValue);

            return (
                <div className="flex items-center gap-4">
                    <span
                        aria-hidden="true"
                        className={`${DISC} ${initials === '' ? 'bg-surface-muted text-ink-muted' : 'bg-action text-on-action'} text-figure-stat`}
                    >
                        {initials === '' ? <Icon name="user" size={24} /> : initials}
                    </span>
                    <div className="flex min-w-0 flex-col">
                        {title === '' ? null : (
                            <p className="text-section-title text-ink [overflow-wrap:anywhere]">{title}</p>
                        )}
                    </div>
                </div>
            );
        }
    }
};
