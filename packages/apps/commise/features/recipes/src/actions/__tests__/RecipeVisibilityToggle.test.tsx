// @vitest-environment jsdom
/**
 * Component tests for the web recipe visibility toggle (T074). Covers the current-state render (checked
 * option), the toggle interaction in both directions, and the free-tier gate (C-004): when `canGoPrivate`
 * is false the private option is disabled, the reason is shown, and selecting it cannot fire `onChange`.
 * State is conveyed by the radio's checked/disabled semantics and text — never colour alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeVisibility } from '@kitchensink/recipe-core';

import { RecipeVisibilityToggle } from '../RecipeVisibilityToggle.js';
import type { RecipeVisibilityToggleProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderToggle(overrides: Partial<RecipeVisibilityToggleProps> = {}) {
    const props: RecipeVisibilityToggleProps = {
        visibility: RecipeVisibility.PUBLIC,
        canGoPrivate: true,
        onChange: noop,
        ...overrides,
    };
    render(<RecipeVisibilityToggle {...props} />);

    return props;
}

describe('RecipeVisibilityToggle (web)', () => {
    it('marks the current visibility as the checked option', () => {
        renderToggle({ visibility: RecipeVisibility.PRIVATE });

        expect(screen.getByRole('radio', { name: 'Private', checked: true })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Public', checked: false })).toBeTruthy();
    });

    it('reports selecting private upward', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderToggle({ visibility: RecipeVisibility.PUBLIC, onChange });

        await user.click(screen.getByRole('radio', { name: 'Private' }));

        expect(onChange).toHaveBeenCalledWith('private');
    });

    it('reports selecting public upward', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderToggle({ visibility: RecipeVisibility.PRIVATE, onChange });

        await user.click(screen.getByRole('radio', { name: 'Public' }));

        expect(onChange).toHaveBeenCalledWith('public');
    });

    it('disables the private option and shows the reason when the tier cannot go private', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderToggle({
            canGoPrivate: false,
            disabledReason: 'Upgrade to make recipes private.',
            onChange,
        });

        const priv = screen.getByRole<HTMLInputElement>('radio', { name: 'Private' });
        expect(priv.disabled).toBe(true);
        expect(screen.getByText('Upgrade to make recipes private.')).toBeTruthy();

        await user.click(priv);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not show a reason when the tier can go private', () => {
        renderToggle({ canGoPrivate: true, disabledReason: 'Upgrade to make recipes private.' });

        expect(screen.queryByText('Upgrade to make recipes private.')).toBeNull();
    });
});

describe('RecipeVisibilityToggle (web) — change error (B17: no silent snap-back)', () => {
    it('surfaces the failed-change copy when error is set', () => {
        renderToggle({ error: true });

        expect(screen.getByRole('alert').textContent).toBe(
            'We couldn\u2019t change who can see this recipe. Please try again.',
        );
    });

    it('shows no alert when the last change did not fail', () => {
        renderToggle({ error: false });

        expect(screen.queryByRole('alert')).toBeNull();
    });
});
