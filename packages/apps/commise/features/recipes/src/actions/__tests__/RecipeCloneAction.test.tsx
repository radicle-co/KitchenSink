// @vitest-environment jsdom
/**
 * Component tests for the web recipe clone action (T075). Covers the clone interaction, both disabled gates
 * (cloning in-flight and not-cloneable), the busy status, and the attribution line — shown only when a
 * source attribution is present.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { buttonSurfaceClass } from '@commise/ui/button';

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

/**
 * Clone IS the design-system Button — it does not paint its own surface.
 *
 * The control used to hand-roll a solid-coral pill, justified by "the mockup paints the clone action coral".
 * That premise is false: NO mockup contains a clone action at all (zero occurrences of clone/duplicate/fork
 * across all nine screens), and the mockups' only coral BUTTON form is a bordered outline
 * (`border-2 border-coral text-coral`) — a solid coral fill appears nowhere except a selected allergy chip.
 * Coral's documented role is "destructive/secondary actions, highlights, warm accents", so a filled-coral
 * pill put a safe, additive, reversible action into the danger register. Clone is a quiet SECONDARY action
 * (the discovery card's own leaf already says exactly that), so it wears the DS `secondary` tier.
 *
 * These assertions pin the surface to the shared recipe by EQUALITY, not by fragment: any re-hand-rolling —
 * a stray colour utility, a re-typed radius, a dropped touch floor — breaks them.
 */
describe('RecipeCloneAction (web) — design-system surface', () => {
    it('wears the DS secondary Button surface verbatim (no hand-rolled pill)', () => {
        renderClone();

        expect(screen.getByRole('button', { name: 'Clone' }).className).toBe(buttonSurfaceClass('secondary'));
    });

    it('paints no bespoke coral FILL — clone stays out of the danger register', () => {
        renderClone();
        const className = screen.getByRole('button', { name: 'Clone' }).className;

        // The regression was a solid `bg-coral` pill at REST, which read as destructive. The DS secondary
        // tier does carry coral — as the mockups' accent OUTLINE (`border-coral`) over glass, and as the
        // hover fill only — so the invariant is "no resting coral fill", not "no coral".
        expect(className).not.toContain('bg-coral');
        expect(className).toContain('border-coral');
        // The surface must be a real DS one, not "no surface at all" (the bare-text regression).
        expect(className).toContain('from-white/80');
    });

    it('pairs the label with a decorative icon that never joins the accessible name', () => {
        renderClone();
        const button = screen.getByRole('button', { name: 'Clone' });

        // The DS Button requires an icon and hides it; the label alone owns the name (Playwright/RTL depend
        // on that). An icon leaking into the name would read as "Clone Clone" or similar.
        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBeNull();
    });

    it('swaps the icon slot for the DS spinner while cloning, keeping the surface and label stable', () => {
        renderClone({ cloning: true });
        const button = screen.getByRole('button', { name: 'Clone' });

        // Busy must not restyle the pill (that would shift layout mid-flight) — same class string as idle.
        expect(button.className).toBe(buttonSurfaceClass('secondary'));
        expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    });

    it('keeps the idle control spinner-free', () => {
        renderClone();

        expect(screen.getByRole('button', { name: 'Clone' }).querySelector('svg.animate-spin')).toBeNull();
    });

    it('keeps the gated control on the same surface, disabled rather than restyled', () => {
        renderClone({ canClone: false });
        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Clone' });

        expect(button.disabled).toBe(true);
        expect(button.className).toBe(buttonSurfaceClass('secondary'));
        // The dim comes from the shared recipe's `disabled:` utility, not a per-call-site opacity tweak.
        expect(button.className).toContain('disabled:opacity-60');
    });
});
