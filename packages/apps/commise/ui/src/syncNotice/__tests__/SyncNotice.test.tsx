/**
 * SyncNotice (web) — written from the contract in `props.ts` and `docs/design/offlineNotice.md`.
 *
 * ⛔ THE ABSENCE OF CONTROLS IS THE CONTRACT. A queued write sends itself on reconnect, so a Retry would
 * claim the cook must act, and a dismiss would hide a condition that is still true.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SyncNotice } from '../SyncNotice.js';

const LABEL = 'Sync status';

describe('SyncNotice (web)', () => {
    it('renders nothing while hidden', () => {
        const { container } = render(<SyncNotice state={{ kind: 'hidden' }} regionLabel={LABEL} />);

        expect(container.textContent).toBe('');
    });

    it('⛔ names the condition AND what has not synced', () => {
        render(
            <SyncNotice
                state={{ kind: 'offline', title: 'You’re offline', body: '2 changes are saved on this device.' }}
                regionLabel={LABEL}
            />,
        );

        expect(screen.getByText('You’re offline')).toBeTruthy();
        expect(screen.getByText('2 changes are saved on this device.')).toBeTruthy();
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

    /** Polite, not assertive: nothing failed and the cook did not just act. */
    it('⛔ announces politely through a named status region', () => {
        render(
            <SyncNotice
                state={{ kind: 'syncing', title: 'Back online', body: 'Syncing 1 change…' }}
                regionLabel={LABEL}
            />,
        );

        const region = screen.getByRole('status', { name: LABEL });

        expect(region.textContent).toContain('Back online');
    });
});
