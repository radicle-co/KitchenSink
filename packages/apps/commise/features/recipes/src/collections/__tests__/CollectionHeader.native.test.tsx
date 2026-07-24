/**
 * Native component tests for the collection-header view (W5 Task 6, rendered via react-native-web under
 * jsdom). Mirrors the web leaf across every branch — non-cloned public, cloned private with full
 * attribution + last-pulled, cloned with an unresolved source owner, the Back affordance, and the
 * Edit/Delete affordances — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionHeader } from '../CollectionHeader.native.js';
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

describe('CollectionHeader (native) — non-cloned collection', () => {
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

describe('CollectionHeader (native) — cloned collection with full attribution', () => {
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

describe('CollectionHeader (native) — cloned collection with an unresolved source owner', () => {
    it('shows the source name without an @handle, and does not crash', () => {
        renderHeader({ sourceCollectionName: 'Keto Staples', sourceOwnerHandle: undefined });

        expect(screen.getByText('Source: "Keto Staples"')).toBeTruthy();
        expect(screen.queryByText(/@/)).toBeNull();
    });
});

describe('CollectionHeader (native) — Back affordance', () => {
    it('renders a Back control that fires onBack', () => {
        const onBack = vi.fn();
        renderHeader({ onBack });

        fireEvent.click(screen.getByRole('button', { name: /back/i }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders no Back control when onBack is omitted', () => {
        renderHeader({ onBack: undefined });

        expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    });
});

describe('CollectionHeader (native) — Edit/Delete affordances', () => {
    it('reports edit and delete requests upward', () => {
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        renderHeader({ onEdit, onDelete });

        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });
});
