/**
 * The web editor's action bar (build spec §1.1, §7.1). At 320 CSS px with 200% zoom Preview and Publish are wider than
 * the bar together; the row must wrap so neither leaves the viewport, and Publish stays last (thumb reach).
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const finishing = (over: Partial<NonNullable<EditorActionBarProps['finishing']>> = {}) => ({
    line: 'Recipe saved. Finishing your photo uploads…',
    danger: false,
    actionLabel: 'Finish without the remaining photos',
    onAction: vi.fn(),
    focusRequested: false,
    onFocusRequestHandled: vi.fn(),
    ...over,
});

/**
 * Waiting for photos after Publish (staff-ux SPECIFY 2026-11-10): Preview and the primary give way to ONE secondary
 * control, the line says what is happening (politely, or in the danger tone once a photo failed), and focus moves to the
 * control because the button the cook pressed is gone (SC 2.4.3). A second Publish here would make a second recipe, which
 * is why the primary is replaced rather than made busy.
 */
describe('EditorActionBar (web): waiting for photos', () => {
    it('shows no Finish control while the editor is not waiting', () => {
        render(<EditorActionBar {...props} />);

        expect(screen.queryByRole('button', { name: 'Finish without the remaining photos' })).toBeNull();
    });

    it('replaces Preview and Publish with the one Finish control, and says the photos are finishing', async () => {
        const state = finishing();
        render(<EditorActionBar {...props} finishing={state} />);

        expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
        expect(screen.getByText('Recipe saved. Finishing your photo uploads…').className).toContain('text-ink-muted');

        await userEvent.click(screen.getByRole('button', { name: 'Finish without the remaining photos' }));
        expect(state.onAction).toHaveBeenCalledOnce();
    });

    it('says a failure in the danger tone', () => {
        const line = '1 photo didn’t upload. Retry it, or finish without it.';
        render(<EditorActionBar {...props} finishing={finishing({ line, danger: true })} />);

        expect(screen.getByText(line).className).toContain('text-danger-text');
    });

    it('moves focus to the Finish control when asked, and acknowledges it', () => {
        const state = finishing({ focusRequested: true });
        render(<EditorActionBar {...props} finishing={state} />);

        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Finish without the remaining photos' }),
        );
        expect(state.onFocusRequestHandled).toHaveBeenCalled();
    });
});
