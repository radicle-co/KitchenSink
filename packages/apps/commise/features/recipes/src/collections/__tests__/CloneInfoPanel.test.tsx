// @vitest-environment jsdom
/**
 * Component tests for the web clone-info panel (W5 Task 8, C5). Covers every branch the mandate requires —
 * full attribution (`@handle / "name"` + Cloned date + View Source), an unresolved source owner (name-only
 * attribution), and a source with neither a resolved owner nor a name (a fully generic fallback, no
 * `undefined` leaking into the DOM) — asserting on role/name/text so a dropped branch fails, and that View
 * Source always fires with the exact `sourceCollectionId`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { utilityContrast } from '@commise/test-utils';

import { CloneInfoPanel } from '../CloneInfoPanel.js';
import type { CloneInfoPanelProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderPanel(overrides: Partial<CloneInfoPanelProps> = {}) {
    const props: CloneInfoPanelProps = {
        sourceOwnerHandle: 'clara',
        sourceCollectionName: 'Keto Staples',
        sourceCollectionId: 'col_source_1',
        clonedAt: '2026-04-28T00:00:00.000Z',
        locale: 'en',
        onViewSource: noop,
        ...overrides,
    };
    render(<CloneInfoPanel {...props} />);

    return props;
}

describe('CloneInfoPanel (web) — full attribution', () => {
    it('renders the handle/name attribution and the cloned date', () => {
        renderPanel();

        expect(screen.getByText('@clara / "Keto Staples"')).toBeTruthy();
        expect(screen.getByText(/Cloned .*Apr(il)? 28, 2026/)).toBeTruthy();
    });

    it('fires onViewSource with the exact sourceCollectionId', async () => {
        const user = userEvent.setup();
        const onViewSource = vi.fn();
        renderPanel({ onViewSource, sourceCollectionId: 'col_source_1' });

        await user.click(screen.getByRole('button', { name: /view source/i }));

        expect(onViewSource).toHaveBeenCalledTimes(1);
        expect(onViewSource).toHaveBeenCalledWith('col_source_1');
    });
});

describe('CloneInfoPanel (web) — unresolved source owner', () => {
    it('shows the name without an @handle, and View Source still fires', async () => {
        const user = userEvent.setup();
        const onViewSource = vi.fn();
        renderPanel({ sourceOwnerHandle: undefined, onViewSource });

        expect(screen.getByText('"Keto Staples"')).toBeTruthy();
        expect(screen.queryByText(/@/)).toBeNull();

        await user.click(screen.getByRole('button', { name: /view source/i }));

        expect(onViewSource).toHaveBeenCalledWith('col_source_1');
    });
});

/**
 * View Source is a bare TEXT control — the reader reads its label, so it carries the 4.5:1 body-text floor,
 * not the 3:1 accent floor `seafoam` clears. It painted `text-seafoam`: 4.02:1 on this white panel at rest and
 * 3.57:1 once `hover:bg-seafoam/10` lands. See `@commise/ui`'s palette JSDoc for where seafoam IS still right.
 */
describe('CloneInfoPanel (web) — View Source clears the AA body-text floor', () => {
    it('keeps the View Source label legible at rest AND over its hover tint', () => {
        renderPanel();
        const viewSource = screen.getByRole('button', { name: /view source/i });

        expect(utilityContrast(viewSource.className), 'View Source at rest').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(viewSource.className, { variant: 'hover' }),
            'View Source on hover',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe('CloneInfoPanel (web) — no resolved owner or name', () => {
    it('renders a generic fallback with no "undefined" leaking, and View Source still fires', async () => {
        const user = userEvent.setup();
        const onViewSource = vi.fn();
        renderPanel({ sourceOwnerHandle: undefined, sourceCollectionName: undefined, onViewSource });

        expect(screen.queryByText(/undefined/i)).toBeNull();
        expect(screen.queryByText(/@/)).toBeNull();

        await user.click(screen.getByRole('button', { name: /view source/i }));

        expect(onViewSource).toHaveBeenCalledWith('col_source_1');
    });
});
