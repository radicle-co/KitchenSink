/**
 * Native component tests for the clone-info panel (W5 Task 8, C5, rendered via react-native-web under
 * jsdom). Mirrors the web leaf across every branch — full attribution, an unresolved source owner, and a
 * source with neither a resolved owner nor a name — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CloneInfoPanel } from '../CloneInfoPanel.native.js';
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

describe('CloneInfoPanel (native) — full attribution', () => {
    it('renders the handle/name attribution and the cloned date', () => {
        renderPanel();

        expect(screen.getByText('@clara / "Keto Staples"')).toBeTruthy();
        expect(screen.getByText(/Cloned .*Apr(il)? 28, 2026/)).toBeTruthy();
    });

    it('fires onViewSource with the exact sourceCollectionId', () => {
        const onViewSource = vi.fn();
        renderPanel({ onViewSource, sourceCollectionId: 'col_source_1' });

        fireEvent.click(screen.getByRole('button', { name: /view source/i }));

        expect(onViewSource).toHaveBeenCalledTimes(1);
        expect(onViewSource).toHaveBeenCalledWith('col_source_1');
    });
});

describe('CloneInfoPanel (native) — unresolved source owner', () => {
    it('shows the name without an @handle, and View Source still fires', () => {
        const onViewSource = vi.fn();
        renderPanel({ sourceOwnerHandle: undefined, onViewSource });

        expect(screen.getByText('"Keto Staples"')).toBeTruthy();
        expect(screen.queryByText(/@/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /view source/i }));

        expect(onViewSource).toHaveBeenCalledWith('col_source_1');
    });
});

describe('CloneInfoPanel (native) — no resolved owner or name', () => {
    it('renders a generic fallback with no "undefined" leaking, and View Source still fires', () => {
        const onViewSource = vi.fn();
        renderPanel({ sourceOwnerHandle: undefined, sourceCollectionName: undefined, onViewSource });

        expect(screen.queryByText(/undefined/i)).toBeNull();
        expect(screen.queryByText(/@/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /view source/i }));

        expect(onViewSource).toHaveBeenCalledWith('col_source_1');
    });
});
