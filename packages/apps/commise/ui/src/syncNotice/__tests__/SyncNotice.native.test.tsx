/**
 * SyncNotice (native) — written from the contract in `props.ts` and `docs/design/offlineNotice.md`, the twin of
 * `SyncNotice.test.tsx`.
 *
 * ⛔ THE ABSENCE OF CONTROLS IS THE CONTRACT. A queued write sends itself on reconnect, so a Retry would claim the cook
 * must act, and a dismiss would hide a condition that is still true. ⛔ AND NO LIVE REGION: the module explains why
 * native announces nothing rather than announcing rudely, so the region is named but never live.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SyncNotice } from '../SyncNotice.native.js';

afterEach(cleanup);

const LABEL = 'Sync status';

describe('SyncNotice (native)', () => {
    it('renders nothing while hidden', () => {
        const { container } = render(<SyncNotice state={{ kind: 'hidden' }} regionLabel={LABEL} />);

        expect(container.textContent).toBe('');
        expect(screen.queryByLabelText(LABEL)).toBeNull();
    });

    it('⛔ names the condition AND what has not synced, inside the named region', () => {
        render(
            <SyncNotice
                state={{ kind: 'offline', title: 'You’re offline', body: '2 changes are saved on this device.' }}
                regionLabel={LABEL}
            />,
        );

        const region = screen.getByLabelText(LABEL);

        expect(region.textContent).toContain('You’re offline');
        expect(region.textContent).toContain('2 changes are saved on this device.');
    });

    it('shows the syncing state the same way', () => {
        render(
            <SyncNotice
                state={{ kind: 'syncing', title: 'Back online', body: 'Syncing 1 change…' }}
                regionLabel={LABEL}
            />,
        );

        expect(screen.getByText('Back online')).toBeTruthy();
        expect(screen.getByText('Syncing 1 change…')).toBeTruthy();
    });

    it('⛔ offers no control — nothing to retry, nothing to dismiss', () => {
        render(
            <SyncNotice
                state={{ kind: 'offline', title: 'You’re offline', body: 'Saved here.' }}
                regionLabel={LABEL}
            />,
        );

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('⛔ is never a live region: reassurance the cook did not ask for is not shouted', () => {
        const { container } = render(
            <SyncNotice
                state={{ kind: 'syncing', title: 'Back online', body: 'Syncing 1 change…' }}
                regionLabel={LABEL}
            />,
        );

        expect(container.querySelector('[aria-live]')).toBeNull();
    });
});
