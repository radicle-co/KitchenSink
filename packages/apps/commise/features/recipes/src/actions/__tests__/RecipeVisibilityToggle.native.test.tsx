/**
 * Native component tests for the recipe visibility toggle (T074), rendered via react-native-web under
 * jsdom. Mirrors the web leaf: current-state render, both toggle directions, and the free-tier gate
 * (C-004) — private disabled + reason shown + selecting it cannot fire `onChange`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { RecipeVisibility } from '@kitchensink/recipe-core';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeVisibilityToggle } from '../RecipeVisibilityToggle.native.js';
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

describe('RecipeVisibilityToggle (native)', () => {
    it('marks the current visibility as the checked option', () => {
        renderToggle({ visibility: RecipeVisibility.PRIVATE });

        expect(screen.getByRole('radio', { name: 'Private', checked: true })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Public', checked: false })).toBeTruthy();
    });

    it('reports selecting private upward', () => {
        const onChange = vi.fn();
        renderToggle({ visibility: RecipeVisibility.PUBLIC, onChange });

        fireEvent.click(screen.getByRole('radio', { name: 'Private' }));

        expect(onChange).toHaveBeenCalledWith('private');
    });

    it('reports selecting public upward', () => {
        const onChange = vi.fn();
        renderToggle({ visibility: RecipeVisibility.PRIVATE, onChange });

        fireEvent.click(screen.getByRole('radio', { name: 'Public' }));

        expect(onChange).toHaveBeenCalledWith('public');
    });

    it('disables the private option and shows the reason when the tier cannot go private', () => {
        const onChange = vi.fn();
        renderToggle({
            canGoPrivate: false,
            disabledReason: 'Upgrade to make recipes private.',
            onChange,
        });

        const priv = screen.getByRole('radio', { name: 'Private' });
        expect(priv.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Upgrade to make recipes private.')).toBeTruthy();

        fireEvent.click(priv);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not show a reason when the tier can go private', () => {
        renderToggle({ canGoPrivate: true, disabledReason: 'Upgrade to make recipes private.' });

        expect(screen.queryByText('Upgrade to make recipes private.')).toBeNull();
    });
});
