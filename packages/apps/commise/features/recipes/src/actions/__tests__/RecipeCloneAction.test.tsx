// @vitest-environment jsdom
/**
 * Component tests for the web recipe clone action (T075). Covers the clone interaction, both disabled gates
 * (cloning in-flight and not-cloneable), the busy status, and the attribution line — shown only when a
 * source attribution is present.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeCloneAction } from '../RecipeCloneAction.js';
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

describe('RecipeCloneAction (web)', () => {
    it('reports clone requests upward', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderClone({ onClone });

        await user.click(screen.getByRole('button', { name: 'Clone' }));

        expect(onClone).toHaveBeenCalledTimes(1);
    });

    it('disables the action and shows a busy status while cloning', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderClone({ cloning: true, onClone });

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Clone' });
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.getByText('Cloning…')).toBeTruthy();

        await user.click(button);
        expect(onClone).not.toHaveBeenCalled();
    });

    it('disables the action when cloning is not allowed', () => {
        renderClone({ canClone: false });

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clone' }).disabled).toBe(true);
    });

    it('renders the attribution line when a source attribution is present', () => {
        renderClone({ sourceAttribution: 'Grandma’s cookbook' });

        expect(screen.getByText('Cloned from Grandma’s cookbook')).toBeTruthy();
    });

    it('omits the attribution line when no source attribution is present', () => {
        renderClone({ sourceAttribution: undefined });

        expect(screen.queryByText(/Cloned from/)).toBeNull();
    });

    it('gives the clone control the 44px touch floor, reset for the mouse at md', () => {
        renderClone();
        const className = screen.getByRole('button', { name: 'Clone' }).className;

        expect(className).toContain('min-h-11');
        expect(className).toContain('md:min-h-0');
    });
});
