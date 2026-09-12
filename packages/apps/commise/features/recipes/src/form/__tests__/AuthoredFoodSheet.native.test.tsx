/**
 * Component tests for the native authored-food Sheet (`docs/design/rowEditorOpenDecisions.md` item 1): the
 * create-my-own-food form as a bottom sheet, the web leaf's twin.
 *
 * Every state the form has (§4 "Authoring"): closed, open, a field error, a failed submit, submitting, the duplicate,
 * its reuse in flight and its reuse failed; and the sheet's rules: titled for the food, its close control named, every
 * close route reaching `onCancel`, and `onDismissed` once it is gone. Native has no DOM focus: the Sheet puts the
 * reading cursor on its title, and the duplicate notice takes it as it replaces the form.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dialogTitled } from '@commise/test-utils';

import type { AuthoredFoodCreateState } from '../../hooks/authoredFoodCreate.model.js';
import { recipeMessages } from '../../messages.js';
import { AuthoredFoodSheet } from '../AuthoredFoodSheet.native.js';
import { recipeFormMessages } from '../messages.js';

// react-native-web does not implement `sendAccessibilityEvent`; the duplicate case reads the calls.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

const copy = recipeMessages.en.ingredientCreateFood;
const form = recipeFormMessages.en;
const DRAFT = { name: 'saffron', calories: '', proteinG: '', carbsG: '', fatG: '' };
const OPEN: AuthoredFoodCreateState = { kind: 'open', draft: DRAFT, fieldErrors: {}, submitFailed: false };

const handlers = () => ({
    onFieldChange: vi.fn(),
    onSubmit: vi.fn(),
    onReuse: vi.fn(),
    onCancel: vi.fn(),
    onDismissed: vi.fn(),
});

const renderSheet = (state: AuthoredFoodCreateState) => {
    const on = handlers();
    const view = render(<AuthoredFoodSheet state={state} {...on} />);

    return { ...on, ...view };
};

const field = (label: string): HTMLInputElement => screen.getByLabelText<HTMLInputElement>(label);

describe('AuthoredFoodSheet (native)', () => {
    it('closed: no sheet, and the same sheet opened is a dialog', () => {
        const on = handlers();
        const { rerender } = render(<AuthoredFoodSheet state={{ kind: 'closed' }} {...on} />);

        expect(screen.queryByRole('dialog')).toBeNull();

        rerender(<AuthoredFoodSheet state={OPEN} {...on} />);

        expect(dialogTitled('Create “saffron”')).toBeTruthy();
    });

    it('open: a sheet titled for the food, its close control named, the typed name in the name field', () => {
        renderSheet(OPEN);

        expect(dialogTitled('Create “saffron”')).toBeTruthy();
        expect(screen.getByRole('button', { name: copy.close })).toBeTruthy();
        expect(field(copy.nameLabel).value).toBe('saffron');

        for (const label of [copy.caloriesLabel, copy.proteinLabel, copy.carbsLabel, copy.fatLabel]) {
            expect(field(label)).toBeTruthy();
        }

        expect(screen.getByText(copy.privateHint)).toBeTruthy();
    });

    it('typing reports each field, and Create submits', () => {
        const { onFieldChange, onSubmit } = renderSheet(OPEN);

        fireEvent.change(field(copy.caloriesLabel), { target: { value: '310' } });
        fireEvent.click(screen.getByRole('button', { name: copy.submit }));

        expect(onFieldChange).toHaveBeenLastCalledWith('calories', '310');
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('a field error is worded under its field', () => {
        renderSheet({ ...OPEN, fieldErrors: { proteinG: 'out_of_range' } });

        expect(screen.getByText(copy.errorOutOfRange)).toBeTruthy();
    });

    it('a failed submit stays in the sheet with the draft, said assertively (statusAuthorFailed)', () => {
        renderSheet({ ...OPEN, draft: { ...DRAFT, calories: '310' }, submitFailed: true });

        expect(screen.getByText(form.statusAuthorFailed)).toBeTruthy();
        expect(field(copy.caloriesLabel).value).toBe('310');
    });

    it('submitting: the fields read only, Create reads busy, and Cancel is unavailable', () => {
        const { onCancel } = renderSheet({ kind: 'submitting', draft: DRAFT });

        expect(field(copy.nameLabel).readOnly).toBe(true);
        expect(screen.getByRole('button', { name: copy.submit }).getAttribute('aria-busy')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByText(copy.submitting)).toBeTruthy();
    });

    it('duplicate: its own sentence takes the reading cursor, and Use that one reuses the food', () => {
        const { onReuse } = renderSheet({
            kind: 'duplicate',
            draft: DRAFT,
            existingFoodId: 'food_mine',
            reusePending: false,
            reuseFailed: false,
        });
        const notice = screen.getByText(copy.duplicateNotice.replace('{name}', 'saffron'));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(notice, 'focus');

        fireEvent.click(screen.getByRole('button', { name: copy.duplicateReuse }));
        expect(onReuse).toHaveBeenCalledTimes(1);
    });

    it('duplicate: a reuse in flight reads busy; a failed reuse is said', () => {
        renderSheet({ kind: 'duplicate', draft: DRAFT, existingFoodId: 'f', reusePending: true, reuseFailed: false });
        expect(screen.getByRole('button', { name: copy.duplicateReuse }).getAttribute('aria-busy')).toBe('true');
        cleanup();

        renderSheet({ kind: 'duplicate', draft: DRAFT, existingFoodId: 'f', reusePending: false, reuseFailed: true });
        expect(screen.getByText(copy.duplicateReuseFailed)).toBeTruthy();
    });

    it.each([
        ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: copy.cancel }))],
        ['Close', () => fireEvent.click(screen.getByRole('button', { name: copy.close }))],
    ])('%s reaches onCancel', (_route, press) => {
        const { onCancel } = renderSheet(OPEN);

        press();

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('reports onDismissed once the sheet is gone, and not before', () => {
        const on = handlers();
        const { rerender } = render(<AuthoredFoodSheet state={OPEN} {...on} />);

        expect(on.onDismissed).not.toHaveBeenCalled();
        rerender(<AuthoredFoodSheet state={{ kind: 'closed' }} {...on} />);

        expect(on.onDismissed).toHaveBeenCalledTimes(1);
    });
});
