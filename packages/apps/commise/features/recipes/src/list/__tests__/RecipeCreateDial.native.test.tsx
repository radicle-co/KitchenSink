/**
 * Native component tests for the recipe-list CREATE DIAL (react-native-web under jsdom). Mirrors
 * `RecipeCreateDial.test.tsx`; moved from the retired `RecipeList.native.test.tsx` ("chrome" and "create FAB (L1)").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Text } from 'react-native';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { RecipeCreateDial } from '../RecipeCreateDial.native.js';

afterEach(cleanup);

const noop = () => undefined;

describe('RecipeCreateDial (native)', () => {
    it('draws the FAB glyph as an icon, never a baseline-positioned "+" character', () => {
        // The icon stub renders null here, so the falsifiable assertion is the ABSENCE of the text glyph.
        render(<RecipeCreateDial onCreateRecipe={noop} />);

        expect(within(screen.getByRole('button', { name: 'New recipe' })).queryByText('+')).toBeNull();
    });

    it('reports create requests upward from the dial’s ONE destination, not from the trigger', () => {
        const onCreateRecipe = vi.fn();
        render(<RecipeCreateDial onCreateRecipe={onCreateRecipe} />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });

    it('offers NO paste destination when the host supplies none — absence removes it, not disables it', () => {
        render(<RecipeCreateDial onCreateRecipe={noop} />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.getByRole('menuitem', { name: 'Create from Scratch' })).toBeTruthy();
        expect(screen.queryByRole('menuitem', { name: 'Paste an Ingredient List' })).toBeNull();
    });

    it('opens the paste surface from the dial’s SECOND destination (plan U9)', () => {
        const onPasteIngredients = vi.fn();
        render(<RecipeCreateDial onCreateRecipe={noop} onPasteIngredients={onPasteIngredients} />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('keeps "Create from Scratch" FIRST — the primary path must not move when a destination is added', () => {
        render(<RecipeCreateDial onCreateRecipe={noop} onPasteIngredients={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Create from Scratch',
            'Paste an Ingredient List',
        ]);
    });

    it('lands on the create surface when the dial’s destination is chosen', () => {
        // Driven STATEFULLY: a spy proves a handler ran, not that anything downstream happened.
        function Harness() {
            const [creating, setCreating] = useState(false);

            return creating ? (
                <Text>{'CREATE SURFACE'}</Text>
            ) : (
                <RecipeCreateDial onCreateRecipe={() => setCreating(true)} />
            );
        }

        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(screen.getByText('CREATE SURFACE')).toBeTruthy();
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
