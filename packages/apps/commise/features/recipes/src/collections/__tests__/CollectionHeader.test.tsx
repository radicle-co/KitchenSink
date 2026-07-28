// @vitest-environment jsdom
/**
 * Component tests for the web collection-header view (W5 Task 6). Covers every branch the mandate
 * requires — a non-cloned public collection (badge + count, no source/last-pulled lines), a cloned private
 * collection with full source attribution + last-pulled, a cloned collection with an unresolved source
 * owner (name-only attribution, no crash), the web Back affordance (C6), and the Edit/Delete affordances
 * (C4) — asserting on role/name/text so a dropped branch fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CollectionHeader } from '../CollectionHeader.js';
import type { CollectionHeaderViewProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderHeader(overrides: Partial<CollectionHeaderViewProps> = {}) {
    const props: CollectionHeaderViewProps = {
        name: 'Keto Week',
        visibility: 'public',
        recipeCount: 8,
        onEdit: noop,
        onDelete: noop,
        ...overrides,
    };
    render(<CollectionHeader {...props} />);

    return props;
}

describe('CollectionHeader (web) — non-cloned collection', () => {
    it('renders the name, the Public badge, and the recipe count', () => {
        renderHeader();

        expect(screen.getByRole('heading', { name: 'Keto Week' })).toBeTruthy();
        expect(screen.getByText('Public')).toBeTruthy();
        expect(screen.getByText('8 recipes')).toBeTruthy();
    });

    it('renders no source-attribution or last-pulled line', () => {
        renderHeader();

        expect(screen.queryByText(/^Source:/)).toBeNull();
        expect(screen.queryByText(/^Last pulled/)).toBeNull();
    });
});

describe('CollectionHeader (web) — cloned collection with full attribution', () => {
    it('renders the Private badge, the templated source attribution, and the last-pulled date', () => {
        renderHeader({
            visibility: 'private',
            sourceCollectionName: 'Keto Staples',
            sourceOwnerHandle: 'clara',
            lastPulledAt: '2026-05-01T00:00:00.000Z',
        });

        expect(screen.getByText('Private')).toBeTruthy();
        expect(screen.getByText('Source: @clara’s "Keto Staples"')).toBeTruthy();
        expect(screen.getByText(/Last pulled: May 1, 2026/)).toBeTruthy();
    });
});

describe('CollectionHeader (web) — cloned collection with an unresolved source owner', () => {
    it('shows the source name without an @handle, and does not crash', () => {
        renderHeader({ sourceCollectionName: 'Keto Staples', sourceOwnerHandle: undefined });

        expect(screen.getByText('Source: "Keto Staples"')).toBeTruthy();
        expect(screen.queryByText(/@/)).toBeNull();
    });
});

describe('CollectionHeader (web) — Back affordance (C6)', () => {
    it('fires onBack when the Back control is activated', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        renderHeader({ onBack });

        await user.click(screen.getByRole('button', { name: /back/i }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders no Back control when onBack is omitted', () => {
        renderHeader({ onBack: undefined });

        expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    });
});

/**
 * Delete is painted in the ERROR register — with the error hue, not coral.
 *
 * The control already labelled itself `text-error` (#E17055) but tinted its hover with `bg-coral/10`
 * (#E8917A) — two adjacent-but-different hues inside one control, and the wrong one for a destructive action:
 * coral is a brand accent (the mockups spend it on tags and warm highlights), `error` is the destructive
 * token, and the design system's own `destructive` Button tier already tints with `hover:bg-error/10`. The
 * native leaf never had the coral at all (`palette.error` text, no tint), so this was a WEB-ONLY drift.
 */
describe('CollectionHeader (web) — Delete stays in the error register', () => {
    it('tints Delete’s hover with the error token, never coral', () => {
        renderHeader();
        const className = screen.getByRole('button', { name: 'Delete' }).className;

        expect(className).toContain('text-error');
        expect(className).toContain('hover:bg-error/10');
        expect(className).not.toContain('coral');
    });

    it('leaves the non-destructive Rename out of the error register entirely', () => {
        renderHeader();
        const className = screen.getByRole('button', { name: 'Rename' }).className;

        // The counterweight assertion: "no coral" must not be reachable by painting EVERYTHING error-toned.
        expect(className).not.toContain('error');
        expect(className).not.toContain('coral');
    });
});

describe('CollectionHeader (web) — Edit/Delete affordances (C4)', () => {
    it('reports edit and delete requests upward', async () => {
        const user = userEvent.setup();
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        renderHeader({ onEdit, onDelete });

        await user.click(screen.getByRole('button', { name: 'Rename' }));
        await user.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });
});

/**
 * Cross-platform parity for the native leaf's `flexShrink` fix (Maestro `collections` /
 * `collections-pagination`, where a long name pushed Rename/Delete off the screen edge on Android). CSS
 * flex items default to `flex-shrink: 1`, so web degraded more gracefully than RN — but the `h1`'s
 * `min-width: auto` still lets a single long token overflow, and the action group could itself be squeezed.
 * Pinning both here keeps the two leaves' overflow behaviour from drifting again.
 */
describe('CollectionHeader (web) — title row cannot squeeze its actions off-screen', () => {
    it('lets a long name shrink and wrap rather than overflow the row', () => {
        renderHeader({ name: 'Maestro renamed collection with a deliberately very long name' });

        const heading = screen.getByRole('heading', {
            name: 'Maestro renamed collection with a deliberately very long name',
        });

        expect(heading.className).toContain('min-w-0');
        expect(heading.className).toContain('break-words');
    });

    it('never shrinks the action group itself, so neither control is clipped', () => {
        renderHeader({ name: 'Maestro renamed collection with a deliberately very long name' });

        const actions = screen.getByRole('button', { name: 'Delete' }).parentElement;

        expect(actions).not.toBeNull();
        expect(actions?.className).toContain('shrink-0');
    });
});
