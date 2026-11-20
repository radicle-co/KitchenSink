/**
 * The web two-column layout (L2, L3): the ingredients column on the left in its own 300 wide scrolling slot, and the
 * step column in the rest, at most 680 wide and centred. Pure layout, so nothing is mocked: the slots are plain text.
 * jsdom draws no Tailwind, so each width is read from the complete class that `cookingLayout` writes beside its number.
 * It is the web twin of the native layout: the same props, the same cases.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CookingTwoColumnLayout } from '../CookingTwoColumnLayout.js';
import { COOKING_COLUMN, INGREDIENTS_COLUMN } from '../cookingLayout.js';

afterEach(cleanup);

const layout = () =>
    render(
        <CookingTwoColumnLayout column={<p>Ingredients here</p>}>
            <p>Step here</p>
        </CookingTwoColumnLayout>,
    );

/** The nearest ancestor of an element whose class list holds a class. */
function ancestorWith(element: HTMLElement, className: string): HTMLElement {
    let node: HTMLElement | null = element.parentElement;

    while (node !== null) {
        if (node.className.split(' ').includes(className)) {
            return node;
        }

        node = node.parentElement;
    }

    throw new Error(`no ancestor holds ${className}`);
}

describe('CookingTwoColumnLayout (web)', () => {
    it('draws the ingredients column before the step column, each once', () => {
        layout();

        expect(screen.getAllByText('Ingredients here')).toHaveLength(1);
        expect(screen.getAllByText('Step here')).toHaveLength(1);
        expect(
            screen.getByText('Ingredients here').compareDocumentPosition(screen.getByText('Step here')) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('puts the ingredients in a 300 wide slot that scrolls on its own, and the step outside it', () => {
        layout();

        const slot = ancestorWith(screen.getByText('Ingredients here'), INGREDIENTS_COLUMN.webClassName);
        const row = slot.parentElement;

        expect(slot.contains(screen.getByText('Step here'))).toBe(false);
        expect(slot.className.split(' ')).toContain('overflow-y-auto');
        expect(slot.className.split(' ')).toContain('shrink-0');
        expect(row?.className.split(' ')).toContain('flex');
        expect(row?.className.split(' ')).toContain('min-h-0');
        expect(row?.className.split(' ')).toContain('flex-1');
        // A row, not a stack: flex-col would draw the ingredients over the step.
        expect(row?.className.split(' ')).not.toContain('flex-col');
    });

    it('draws the slot on the canvas, inset 16 on every side inside its own scroll', () => {
        layout();

        const slot = ancestorWith(screen.getByText('Ingredients here'), INGREDIENTS_COLUMN.webClassName);

        expect(slot.className.split(' ')).toContain('bg-canvas');
        expect(slot.className.split(' ')).toContain('p-4');
    });

    it('centres the step in the rest, at most 680 wide', () => {
        layout();

        const step = ancestorWith(screen.getByText('Step here'), COOKING_COLUMN.webClassName);

        expect(step.contains(screen.getByText('Ingredients here'))).toBe(false);
        expect(step.className.split(' ')).toContain('w-full');

        // The step slot is a flex column that may shrink, as on native, so a step body fills the height and keeps its
        // footer pinned inside it.
        for (const token of ['flex', 'min-h-0', 'flex-col']) {
            expect(step.className.split(' ')).toContain(token);
        }

        // `justify-center` centres only inside a flex container.
        expect(step.parentElement?.className.split(' ')).toContain('flex');
        expect(step.parentElement?.className.split(' ')).toContain('justify-center');
        expect(step.parentElement?.className.split(' ')).toContain('flex-1');
        // Without min-w-0 a long word in the step would widen the area and push the page sideways.
        expect(step.parentElement?.className.split(' ')).toContain('min-w-0');
    });
});
