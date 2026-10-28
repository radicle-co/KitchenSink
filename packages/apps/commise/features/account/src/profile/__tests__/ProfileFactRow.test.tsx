// @vitest-environment jsdom
/**
 * The web read-only Profile row: a label and a value the cook cannot change here. It is text, not a control, and a long
 * unbroken value wraps instead of overflowing 320 px. This restores the "unbroken email wraps at 320 px" case that lived
 * in the ProfileHeader suite until the email moved into this row.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileFactRow } from '../ProfileFactRow.js';

afterEach(cleanup);

describe('ProfileFactRow (web)', () => {
    it('shows the label and the value', () => {
        render(<ProfileFactRow label="Email" value="eliza@example.com" />);

        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.getByText('eliza@example.com')).toBeTruthy();
    });

    it('is plain text: no button, no link', () => {
        render(<ProfileFactRow label="Email" value="eliza@example.com" />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('lets an unbroken value wrap anywhere instead of overflowing 320 px', () => {
        const email = `${'a'.repeat(60)}@example.com`;
        render(<ProfileFactRow label="Email" value={email} />);

        const value = screen.getByText(email);

        expect(value.className).toContain('[overflow-wrap:anywhere]');
        // `min-w-0` is what lets the flex item shrink below its content width so the wrap can happen.
        expect(value.className).toContain('min-w-0');
    });
});
