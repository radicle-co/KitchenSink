// @vitest-environment jsdom
/**
 * Tests for the blocked-account notice (U3). It is a pure presentational leaf: it renders the shared block
 * message (title + body) on a real, error-toned alert surface (`role="alert"`), so a suspended/impersonated
 * state reads as a genuine warning rather than unstyled body text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { AuthBlockMessage } from '@commise/features-account';

import { AccountStateNotice } from '../AccountStateNotice';

afterEach(cleanup);

const message: AuthBlockMessage = {
    title: 'Account suspended',
    body: 'Your account is suspended. Contact support to restore access.',
    code: 'account_suspended',
};

describe('AccountStateNotice (U3)', () => {
    it('renders the block message on an alert surface', () => {
        render(<AccountStateNotice message={message} />);

        const alert = screen.getByRole('alert');
        expect(within(alert).getByRole('heading', { name: 'Account suspended' })).toBeTruthy();
        expect(alert.textContent).toContain('Contact support to restore access.');
    });

    it('names the alert via its title heading', () => {
        render(<AccountStateNotice message={message} />);

        expect(screen.getByRole('alert', { name: 'Account suspended' })).toBeTruthy();
    });
});
