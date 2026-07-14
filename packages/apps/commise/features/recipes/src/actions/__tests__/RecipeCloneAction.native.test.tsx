/**
 * Native component tests for the recipe clone action (T075), rendered via react-native-web under jsdom.
 * Mirrors the web leaf: clone interaction, both disabled gates (cloning in-flight and not-cloneable), the
 * busy indicator, and the attribution line shown only when a source attribution is present.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCloneAction } from '../RecipeCloneAction.native.js';
import type { RecipeCloneActionProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderClone(overrides: Partial<RecipeCloneActionProps> = {}) {
    const props: RecipeCloneActionProps = {
        canClone: true,
        onClone: noop,
        ...overrides,
    };
    render(<RecipeCloneAction {...props} />);

    return props;
}

describe('RecipeCloneAction (native)', () => {
    it('reports clone requests upward', () => {
        const onClone = vi.fn();
        renderClone({ onClone });

        fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

        expect(onClone).toHaveBeenCalledTimes(1);
    });

    it('disables the action and shows a busy indicator while cloning', () => {
        const onClone = vi.fn();
        renderClone({ cloning: true, onClone });

        const button = screen.getByRole('button', { name: 'Clone' });
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Cloning…')).toBeTruthy();

        fireEvent.click(button);
        expect(onClone).not.toHaveBeenCalled();
    });

    it('disables the action when cloning is not allowed', () => {
        renderClone({ canClone: false });

        expect(screen.getByRole('button', { name: 'Clone' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('renders the attribution line when a source attribution is present', () => {
        renderClone({ sourceAttribution: 'Grandma’s cookbook' });

        expect(screen.getByText('Cloned from Grandma’s cookbook')).toBeTruthy();
    });

    it('omits the attribution line when no source attribution is present', () => {
        renderClone({ sourceAttribution: undefined });

        expect(screen.queryByText(/Cloned from/)).toBeNull();
    });
});
