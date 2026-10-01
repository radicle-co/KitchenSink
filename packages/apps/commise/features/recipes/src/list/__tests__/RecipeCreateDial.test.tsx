// @vitest-environment jsdom
/**
 * Component tests for the web recipe-list CREATE DIAL — the pinned FAB that discloses the creation destinations
 * (U34), mounted by both the settled results and the load error.
 *
 * Moved from the retired `RecipeList.test.tsx` ("chrome" and "create FAB (L1)"), where the dial's destinations were
 * spelled inline. WHEN the dial mounts is not this component's question: see `RecipeListResults.test.tsx`,
 * `RecipeListLoading.test.tsx` and `RecipeListLoadError.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeCreateDial } from '../RecipeCreateDial.js';

afterEach(cleanup);

const noop = () => undefined;

describe('RecipeCreateDial (web)', () => {
    it('draws the FAB glyph as a geometrically centred icon, not a baseline-positioned character', () => {
        // The FAB rendered the literal text "+", whose ink sits on the math axis rather than the em-box centre, so it
        // painted ~1.7px low at 24px — an offset no centring property fixes. The mockup draws a symmetric SVG.
        render(<RecipeCreateDial onCreateRecipe={noop} />);

        const fab = screen.getByRole('button', { name: 'New recipe' });

        expect(fab.querySelector('svg')).not.toBeNull();
        expect(fab.textContent).toBe('');
    });

    it('pins the control rather than flowing it with the page', () => {
        // Position isn't queryable in jsdom; the pinned-FAB class sits on the dial's anchor, so the disclosed menu is
        // positioned against the SAME offset. The offset expression itself is asserted by `SpeedDial.test.tsx`.
        render(<RecipeCreateDial onCreateRecipe={noop} />);

        expect(screen.getByRole('button', { name: 'New recipe' }).parentElement?.className).toContain('fixed');
    });

    it('reports create requests upward from the dial’s ONE destination, not from the trigger', async () => {
        // The FAB is a menu TRIGGER (U34, owner ruling 2026-08-25), so the create request comes from the destination —
        // an assertion on the trigger would pass against a dial that opened and wired its item to nothing.
        const user = userEvent.setup();
        const onCreateRecipe = vi.fn();
        render(<RecipeCreateDial onCreateRecipe={onCreateRecipe} />);

        await user.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).not.toHaveBeenCalled();

        await user.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });

    it('offers NO paste destination when the host supplies none — absence removes it, not disables it', async () => {
        const user = userEvent.setup();
        render(<RecipeCreateDial onCreateRecipe={noop} />);

        await user.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.getByRole('menuitem', { name: 'Create from Scratch' })).toBeTruthy();
        expect(screen.queryByRole('menuitem', { name: 'Paste an Ingredient List' })).toBeNull();
    });

    it('opens the paste surface from the dial’s SECOND destination (plan U9)', async () => {
        const user = userEvent.setup();
        const onPasteIngredients = vi.fn();
        render(<RecipeCreateDial onCreateRecipe={noop} onPasteIngredients={onPasteIngredients} />);

        await user.click(screen.getByRole('button', { name: 'New recipe' }));
        await user.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('keeps "Create from Scratch" FIRST — the primary path must not move when a destination is added', async () => {
        const user = userEvent.setup();
        render(<RecipeCreateDial onCreateRecipe={noop} onPasteIngredients={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Create from Scratch',
            'Paste an Ingredient List',
        ]);
    });

    it('lands on the create surface when the dial’s destination is chosen', async () => {
        // Driven STATEFULLY: a spy proves a handler ran, not that anything downstream happened.
        const user = userEvent.setup();

        function Harness() {
            const [creating, setCreating] = useState(false);

            return creating ? (
                <h1>{'CREATE SURFACE'}</h1>
            ) : (
                <RecipeCreateDial onCreateRecipe={() => setCreating(true)} />
            );
        }

        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'New recipe' }));
        await user.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(screen.getByRole('heading', { name: 'CREATE SURFACE' })).toBeTruthy();
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
