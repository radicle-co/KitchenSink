// @vitest-environment jsdom
/**
 * Component tests for the web `ImportWizardLeave` (board WizardLeave): "Save and leave?" as a dialog that says how many
 * recipes the cook reviewed, that the rest are saved now with their binding lines and every other line as written, and
 * where they wait and where the review resumes — then Keep reviewing or Save and leave. Not a destructive confirm:
 * nothing is lost, so neither action wears the danger tone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImportWizardLeave } from '../ImportWizardLeave.js';
import { importMessages } from '../messages.js';
import type { ImportWizardLeaveProps } from '../props.js';

const l = importMessages.en.leave;

afterEach(cleanup);

function renderLeave(overrides: Partial<ImportWizardLeaveProps> = {}) {
    const onKeepReviewing = vi.fn();
    const onConfirm = vi.fn();
    render(
        <ImportWizardLeave
            open
            reviewed={14}
            total={309}
            resumeAt={15}
            onKeepReviewing={onKeepReviewing}
            onConfirm={onConfirm}
            {...overrides}
        />,
    );

    return { onKeepReviewing, onConfirm };
}

describe('ImportWizardLeave (web)', () => {
    it('renders nothing while closed', () => {
        renderLeave({ open: false });

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is a dialog named “Save and leave?” that says what happens to every recipe', () => {
        renderLeave();

        const dialog = screen.getByRole('dialog', { name: l.title });

        expect(within(dialog).getByText('You reviewed 14 of 309 recipes.')).toBeTruthy();
        expect(within(dialog).getByText('The other 295 are saved now.')).toBeTruthy();
        // The one bulk rule, word for word the mode choice's (`import.saveAsWritten.rule`).
        expect(
            within(dialog).getByText(
                'Matched foods and the usual defaults are set, and each default keeps its Default tag. Every other line is saved as written, with no food, for you to choose later.',
            ),
        ).toBeTruthy();
        expect(
            within(dialog).getByText('They wait under “To review” in My recipes, and you can pick up at recipe 15.'),
        ).toBeTruthy();
    });

    it('Keep reviewing keeps reviewing; Save and leave confirms', async () => {
        const user = userEvent.setup();
        const { onKeepReviewing, onConfirm } = renderLeave();

        await user.click(screen.getByRole('button', { name: l.keep }));
        expect(onKeepReviewing).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: l.confirm }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('its close control says that closing keeps reviewing, and does', async () => {
        const user = userEvent.setup();
        const { onKeepReviewing, onConfirm } = renderLeave();

        await user.click(screen.getByRole('button', { name: l.close }));

        expect(l.close.startsWith('Close')).toBe(true);
        expect(onKeepReviewing).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('closing the dialog any other way keeps reviewing', async () => {
        const user = userEvent.setup();
        const { onKeepReviewing, onConfirm } = renderLeave();

        await user.keyboard('{Escape}');

        expect(onKeepReviewing).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('while the save is in flight, Save and leave is busy and cannot fire again', async () => {
        const user = userEvent.setup();
        const { onConfirm } = renderLeave({ saving: true });

        const confirm = screen.getByRole('button', { name: l.confirm });

        expect(confirm.getAttribute('aria-busy')).toBe('true');

        await user.click(confirm);

        expect(onConfirm).not.toHaveBeenCalled();
    });

    // U11: at narrow the two stack with the PRIMARY LAST, nearest the thumb, in the same order the keyboard reaches them;
    // the footer used to reverse its column, so the eye and Tab disagreed.
    it('stacks Keep reviewing then Save and leave, in visual and Tab order alike, the primary last', () => {
        renderLeave();

        const keep = screen.getByRole('button', { name: l.keep });
        const confirm = screen.getByRole('button', { name: l.confirm });
        const footer = keep.closest('div.flex');

        expect(keep.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(footer?.className.split(' ')).toContain('flex-col');
        expect(footer?.className).not.toContain('reverse');
    });

    it('never counts below zero recipes saved now', () => {
        renderLeave({ reviewed: 309, total: 309 });

        expect(screen.getByText('The other 0 are saved now.')).toBeTruthy();
    });
});
