/**
 * The web editor's action bar (build spec §1.1, §7.1). At 320 CSS px with 200% zoom Preview and Publish are wider than
 * the bar together; the row must wrap so neither leaves the viewport, and Publish stays last (thumb reach).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditorActionBar } from '../EditorActionBar';
import type { EditorActionBarProps } from '../frameProps.js';

afterEach(cleanup);

const props: EditorActionBarProps = {
    label: 'Recipe actions',
    previewLabel: 'Preview',
    onPreview: vi.fn(),
    primaryLabel: 'Publish',
    onPrimary: vi.fn(),
    primaryDisabled: false,
    busy: false,
};

describe('EditorActionBar (web): large text and narrow widths', () => {
    it('⛔ wraps its controls, so a row too wide for the bar stacks instead of overflowing', () => {
        render(<EditorActionBar {...props} />);

        expect(screen.getByRole('group', { name: 'Recipe actions' }).className).toContain('flex-wrap');
    });

    it('keeps Publish after Preview, so a stacked bar leaves the primary at the bottom', () => {
        render(<EditorActionBar {...props} />);

        const buttons = screen.getAllByRole('button').map((b) => b.textContent);

        expect(buttons.indexOf('Publish')).toBeGreaterThan(buttons.indexOf('Preview'));
    });
});
