/**
 * The row editor's "Counted as" line (web). Designer ruling 2026-11-11: a long food wraps beside Change, and Change keeps
 * its own size on that line, its label never wrapping. jsdom does no layout, so this reads the classes that produce it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRowLineEditorView } from '../../__fixtures__/rowLineEditorView.js';
import { IngredientLineEditor } from '../IngredientLineEditor.js';
import { recipeFormMessages } from '../messages.js';

afterEach(cleanup);

const m = recipeFormMessages.en;

describe('IngredientLineEditor (web) — the Counted as line', () => {
    it('keeps Change at its own size beside the food, on a line that does not wrap', () => {
        const food = 'Smoked Paprika, sweet, from Spain';

        render(
            <IngredientLineEditor
                view={makeRowLineEditorView({ food, onChangeFood: vi.fn() })}
                index={0}
                m={m}
                details={null}
            />,
        );
        const row = screen.getByText(food).parentElement as HTMLElement;
        const change = screen.getByRole('button', { name: m.rowChange });
        const slot = Array.from(row.children).find((child) => child.contains(change)) as HTMLElement;

        expect(row.className.split(' ')).toContain('flex-nowrap');
        expect(row.className.split(' ')).not.toContain('flex-wrap');
        expect(slot.className.split(' ')).toContain('shrink-0');
    });
});
