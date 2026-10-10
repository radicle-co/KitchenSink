'use client';

/**
 * @module @commise/features-account/profile/ProfileHeader — the Profile page's identity block (web): a 72 px avatar
 * disc, the display name and the email (`buildSpec.md` §9.1, §3.8).
 *
 * Three states, never a blocked page: loading is a skeleton (the groups under it still render), ready is the name and
 * email, and failed shows the `user` glyph and says so with a Try again control. A cook with no name yet sees only the
 * email: the page never invents one.
 *
 * @pattern Visitor — an exhaustive switch over the profile read's three states
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { profileMessages } from './messages.js';
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
                    <span aria-hidden="true" className="flex flex-col gap-2">
                        <span className="h-5 w-40 rounded-sm bg-surface-muted" />
                        <span className="h-4 w-56 max-w-full rounded-sm bg-surface-muted" />
                    </span>
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
                        <Button variant="secondary" size="sm" icon="rotateCcw" onPress={onRetry}>
                            {t.retry}
                        </Button>
                    </div>
                </div>
            );
        case 'ready':
            return (
                <div className="flex items-center gap-4">
                    <span
                        aria-hidden="true"
                        className={`${DISC} ${initials === '' ? 'bg-surface-muted text-ink-muted' : 'bg-action text-on-action'} text-figure-stat`}
                    >
                        {initials === '' ? <Icon name="user" size={24} /> : initials}
                    </span>
                    <div className="flex min-w-0 flex-col">
                        {read.displayName === '' ? null : (
                            <p className="text-section-title text-ink [overflow-wrap:anywhere]">{read.displayName}</p>
                        )}
                        <p className="text-meta text-ink-muted [overflow-wrap:anywhere]">{read.email}</p>
                    </div>
                </div>
            );
    }
};
