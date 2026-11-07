// @vitest-environment jsdom
/**
 * The web read-only Profile row: a label and a value the cook cannot change here. It is text, not a control, and a long
 * unbroken value wraps instead of overflowing 320 px. This restores the "unbroken email wraps at 320 px" case that lived
 * in the ProfileHeader suite until the email moved into this row.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileFactRow } from '../ProfileFactRow.js';
import { LABEL_VALUE_MIN_ROOM } from '../model.js';

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

// Designer ruling 2026-11-01 (`nativeBoards/designAnswers.md`): the web stacks by the same room as native, as a container
// query on the group's card, the `rows` container, at 17.5 rem, so it follows the browser's text size. 17.5 rem is
// 280 px at the default 16 px, the native rule's LABEL_VALUE_MIN_ROOM. jsdom evaluates no container query, so these
// tests read the classes; `tailwindTheme.integration.test.ts` in the web app proves the query compiles.
describe('ProfileFactRow (web) — stacking by room', () => {
    const below = `@max-[${String(LABEL_VALUE_MIN_ROOM / 16)}rem]/rows:`;

    it('sets the value beside its label, at the end, with room', () => {
        render(<ProfileFactRow label="Email" value="eliza@example.com" />);
        const row = screen.getByText('Email').parentElement as HTMLElement;

        expect(row.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'items-center', 'justify-between']));
        expect(row.className.split(' ')).toContain('gap-3');
        expect(screen.getByText('eliza@example.com').className.split(' ')).toContain('text-end');
    });

    it('stacks the value under its label, at the start and 4 px apart, below 17.5 rem of room', () => {
        render(<ProfileFactRow label="Email" value="eliza@example.com" />);
        const row = screen.getByText('Email').parentElement as HTMLElement;

        expect(row.className.split(' ')).toEqual(
            expect.arrayContaining([`${below}flex-col`, `${below}items-start`, `${below}gap-1`]),
        );
        expect(screen.getByText('eliza@example.com').className.split(' ')).toContain(`${below}text-start`);
    });
});
