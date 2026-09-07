// @vitest-environment jsdom
/**
 * Component tests for the web Pull-Updates preview dialog (W5 Task 10, C2 / FR-011) — the wireframe's
 * "Pull Updates Preview Dialog": a Radix `Dialog` (focus-trap, Escape-dismiss, focus-return, ALL free from
 * Radix per CR-003). Covers every branch the mandate requires: closed (nothing rendered), the loading
 * affordance, a populated diff (counts + note + the count-templated Pull action), the empty (nothing-to-
 * pull) diff, the drift (409) and generic error states — neither a dead end, Cancel still works — the
 * in-flight commit (disabled + busy, no double-fire), Cancel, and Escape/focus-return.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import type { PullDiff } from '@kitchensink/recipe-service-client';

import { PullUpdatesDialog } from '../PullUpdatesDialog.js';
import type { PullUpdatesDialogProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

const populatedDiff: PullDiff = { added: ['rec_a', 'rec_b'], removed: [], unchanged: ['rec_c'] };

function baseProps(overrides: Partial<PullUpdatesDialogProps> = {}): PullUpdatesDialogProps {
    return {
        open: true,
        isLoadingPreview: false,
        isCommitting: false,
        sourceOwnerHandle: 'mealplan_clara',
        sourceCollectionName: 'Keto Staples',
        onCancel: noop,
        onConfirm: noop,
        ...overrides,
    };
}

describe('PullUpdatesDialog (web) — closed', () => {
    it('renders no dialog while closed', () => {
        render(<PullUpdatesDialog {...baseProps({ open: false, diff: populatedDiff })} />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('PullUpdatesDialog (web) — loading preview', () => {
    it('shows a progress affordance and no counts while the preview is loading', () => {
        render(<PullUpdatesDialog {...baseProps({ isLoadingPreview: true })} />);

        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByText(/will be added/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Pull/ })).toBeNull();
    });
});

describe('PullUpdatesDialog (web) — populated diff', () => {
    it('shows the source attribution', () => {
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff })} />);

        expect(screen.getByText('@mealplan_clara / Keto Staples')).toBeTruthy();
    });

    it('shows the added/removed/unchanged counts and the protection note', () => {
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff })} />);

        expect(screen.getByText('2 new public recipes will be added')).toBeTruthy();
        expect(screen.getByText('0 recipes removed from source')).toBeTruthy();
        expect(screen.getByText('1 already in this collection (no changes)')).toBeTruthy();
        expect(screen.getByText('Recipes you added directly will not be overwritten.')).toBeTruthy();
    });

    it('the count-templated Pull action fires onConfirm', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, onConfirm })} />);

        const confirm = screen.getByRole('button', { name: 'Pull 2 Recipes' });
        await user.click(confirm);

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});

describe('PullUpdatesDialog (web) — empty diff (nothing to pull)', () => {
    it('disables the Pull action and shows an up-to-date message; onConfirm cannot fire', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        const emptyDiff: PullDiff = { added: [], removed: [], unchanged: ['rec_c', 'rec_d'] };
        render(<PullUpdatesDialog {...baseProps({ diff: emptyDiff, onConfirm })} />);

        expect(screen.getByText('You’re all caught up — there’s nothing new to pull.')).toBeTruthy();
        const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Pull 0 Recipes' });
        expect(confirm.disabled).toBe(true);

        await user.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

describe('PullUpdatesDialog (web) — drift error (409: not a dead end)', () => {
    it('shows the re-preview/retry message, hides the stale counts, and still lets Cancel work', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, error: 'drift', onCancel })} />);

        expect(screen.getByRole('alert').textContent).toMatch(/source collection changed/i);
        expect(screen.queryByText(/will be added/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Pull/ })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('PullUpdatesDialog (web) — generic error', () => {
    it('shows a generic error alert', () => {
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, error: 'generic' })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t check for updates. Please try again.');
    });
});

describe('PullUpdatesDialog (web) — committing', () => {
    it('disables the Pull action, marks it busy, and does not double-fire onConfirm', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, isCommitting: true, onConfirm })} />);

        const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Pull 2 Recipes' });
        expect(confirm.disabled).toBe(true);
        expect(confirm.getAttribute('aria-busy')).toBe('true');

        await user.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

describe('PullUpdatesDialog (web) — dismissal', () => {
    it('Cancel fires onCancel', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<PullUpdatesDialog {...baseProps({ diff: populatedDiff, onCancel })} />);

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('is an accessible role="dialog"; Escape fires onCancel and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();

        function Harness() {
            const [open, setOpen] = useState(false);

            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Open pull preview
                    </button>
                    <PullUpdatesDialog
                        {...baseProps({
                            diff: populatedDiff,
                            open,
                            onCancel: () => {
                                onCancel();
                                setOpen(false);
                            },
                        })}
                    />
                </>
            );
        }

        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Open pull preview' }));

        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();

        // Radix's FocusScope restores focus to the previously-active element from an unmount-cleanup
        // `setTimeout(0)` (`@radix-ui/react-focus-scope`) — a real macrotask, not a React state update, so
        // it needs one real tick to elapse rather than an RTL `waitFor` (which some Radix versions don't
        // trip via mutation observation here, since the returning focus is not itself a DOM mutation).
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open pull preview' }));
    });
});
