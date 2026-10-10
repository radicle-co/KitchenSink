/**
 * Native component tests for the Paste steps control (`docs/design/uiOverhaul/buildSpec.md` §7.6, §7.12), rendered
 * through react-native-web under jsdom. Mirrors `PasteStepsControl.test.tsx`. Native reads no clipboard itself: the
 * field's own system paste menu pastes (Settled 34), so the tests type into the field.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { recipeFormMessages } from '../messages.js';
import { editorMessages } from '../../editor/messages.js';
import { PasteStepsControl } from '../PasteStepsControl.native.js';

const s = editorMessages.en.steps;

afterEach(cleanup);

const field = (): HTMLTextAreaElement => screen.getByRole<HTMLTextAreaElement>('textbox', { name: s.pasteLabel });

describe('PasteStepsControl (native)', () => {
    it('opens a sheet titled "Paste steps" with the labelled field and its hint', () => {
        render(<PasteStepsControl onAdd={vi.fn()} />);

        expect(screen.queryByRole('textbox', { name: s.pasteLabel })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: s.paste }));

        expect(screen.getByRole('heading', { name: s.pasteTitle })).toBeTruthy();
        expect(field()).toBeTruthy();
        expect(screen.getByText(s.pasteHint)).toBeTruthy();
    });

    it('counts live, disabled at 0, and adds the split steps then closes', () => {
        const onAdd = vi.fn();
        render(<PasteStepsControl onAdd={onAdd} />);
        fireEvent.click(screen.getByRole('button', { name: s.paste }));

        const none = screen.getByRole('button', { name: 'Add 0 steps' });
        expect(none.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(none);
        expect(onAdd).not.toHaveBeenCalled();

        fireEvent.change(field(), { target: { value: '1) Boil.\n2) Drain.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add 2 steps' }));

        expect(onAdd).toHaveBeenCalledWith(['Boil.', 'Drain.']);
        expect(screen.queryByRole('textbox', { name: s.pasteLabel })).toBeNull();
    });

    it('says "Add 1 step" for one', () => {
        render(<PasteStepsControl onAdd={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: s.paste }));

        fireEvent.change(field(), { target: { value: 'Boil.' } });

        expect(screen.getByRole('button', { name: 'Add 1 step' })).toBeTruthy();
    });

    // F11 (`evaluateFinal.md`; `buildSpec.md` §5.1): the primary fills the sheet and the × is the only way out, as the
    // New collection sheet does on a phone.
    it('fills the primary and has no Cancel; the × closes without adding, and the next open starts empty', () => {
        const onAdd = vi.fn();
        render(<PasteStepsControl onAdd={onAdd} />);
        fireEvent.click(screen.getByRole('button', { name: s.paste }));

        expect(screen.getByRole('button', { name: 'Add 0 steps' }).style.alignSelf).toBe('stretch');
        expect(screen.queryByRole('button', { name: s.pasteCancel })).toBeNull();

        fireEvent.change(field(), { target: { value: 'Boil.' } });
        fireEvent.click(screen.getByRole('button', { name: recipeFormMessages.en.pasteStepsClose }));

        expect(onAdd).not.toHaveBeenCalled();
        expect(screen.queryByRole('textbox', { name: s.pasteLabel })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: s.paste }));
        expect(field().value).toBe('');
    });
});
