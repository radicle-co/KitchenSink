// @vitest-environment jsdom
/**
 * Curated U15 — the WEB read view's variant line (`docs/design/ingredientSpecialization.md` §S1, §S4, §S5; origin F3,
 * R24, R25, R27 to R29).
 *
 * A variant-bound line shows its root's name with the variant's dotted line under it, before the cook's own words. A
 * root-bound line shows the name only. The checkbox's accessible name carries every part, comma-joined, while the
 * screen never shows a comma-joined label. The native mirror is `variantLineSurface.native.test.tsx`; both assert the
 * same set (§14).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { commaJoinedTexts } from '../../__tests__/commaJoinedTexts.js';
import { makeRecipeDetail, idleUnreachableRetry } from '../../__fixtures__/index.js';
import {
    BRISKET_FLAT_HALF_PARTS,
    BRISKET_FLAT_HALF_SPOKEN,
    makeRootBoundLine,
    makeVariantBoundLine,
} from '../__fixtures__/variantLines.js';
import { QUANTITY_LINE_SHAPES } from '../__fixtures__/quantityLineShapes.js';
import { RecipeDetailView } from '../RecipeDetailView.js';
import { resetServingScale } from '../servingScale.js';

afterEach(() => {
    cleanup();
    resetServingScale();
});

const PART_TEXTS = BRISKET_FLAT_HALF_PARTS.map((part) => part.text);

/** The list item that holds the checkbox named `name`. */
function lineItem(name: string): HTMLElement {
    const item = screen.getByRole('checkbox', { name }).closest('li');

    if (item === null) {
        throw new Error(`No list item holds the checkbox "${name}".`);
    }

    return item;
}

/** The parts a line's dotted line shows, in order: each part is one `lang="en"` span of the primitive. */
const shownParts = (item: HTMLElement): readonly string[] =>
    Array.from(item.querySelectorAll('[lang="en"]')).map((part) => part.textContent);

describe('RecipeDetailView (web) — a variant-bound line (F1/AE1 display, R25)', () => {
    it('shows the root name, and every part on one dotted line in wire order', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeVariantBoundLine()] })}
            />,
        );

        const item = lineItem(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);

        expect(within(item).getByText('beef brisket')).toBeTruthy();
        expect(shownParts(item)).toEqual(PART_TEXTS);
        // The middle dot separates them on screen (§S4).
        expect(item.textContent).toContain('flat half ·');
    });

    it('names the checkbox `{quantity} {food}, {parts}`, every part comma-joined for a screen reader (§S5, R27)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeVariantBoundLine()] })}
            />,
        );

        expect(
            screen.getByRole('checkbox', {
                name: '2 lb beef brisket, flat half, separable lean and fat, 1/8-inch trim, select, braised',
            }),
        ).toBeTruthy();
    });

    it('puts the dotted line under the name and BEFORE the cook’s own preparation and notes (§S5)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [makeVariantBoundLine({ preparation: 'sliced thin', notes: 'trim the cap' })],
                })}
            />,
        );

        const item = lineItem(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);
        const name = within(item).getByText('beef brisket');
        const firstPart = item.querySelector('[lang="en"]');
        const preparation = within(item).getByText('sliced thin');
        const notes = within(item).getByText('trim the cap');

        expect(firstPart).not.toBeNull();
        expect(name.compareDocumentPosition(firstPart as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(firstPart?.compareDocumentPosition(preparation) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(preparation.compareDocumentPosition(notes)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        // "Under": the dotted line takes a line of its own inside the row's text block.
        expect(firstPart?.closest('.block')).not.toBeNull();
    });
});

/**
 * The quantity reads with the name (`docs/design/variantDetailsMockup.html` frame 1, the E2 re-check;
 * `docs/design/readSurfacesEvaluation.md` D1). jsdom lays nothing out, so this pins the STRUCTURE that keeps the two on
 * one line: the row holds the checkbox and one text block, and the quantity flows inside that block before the name.
 * The measured geometry is `web/tests/e2e/recipeDetailLineAlignment.spec.ts`'s.
 */
describe('RecipeDetailView (web) — the quantity flows with the name (D1)', () => {
    it('puts the quantity inside the text block, just before the name, never in a flex item of its own', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeVariantBoundLine()] })}
            />,
        );

        const item = lineItem(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);
        const quantity = within(item).getByText('2 lb');
        const name = within(item).getByText('beef brisket');
        const block = Array.from(item.children).find((child) => child.contains(name));

        expect(item.children).toHaveLength(2);
        expect(block?.contains(quantity)).toBe(true);
        expect(block?.textContent?.startsWith('2 lb beef brisket')).toBe(true);
    });

    it('aligns the row’s items to the top, so a two-line row keeps its checkbox by the first line', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeVariantBoundLine()] })}
            />,
        );

        const item = lineItem(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);

        expect(item.classList.contains('items-start')).toBe(true);
        expect(item.classList.contains('items-center')).toBe(false);
    });

    for (const shape of QUANTITY_LINE_SHAPES) {
        it(`${shape.what}: the quantity leads the name in the row's one text block`, () => {
            render(
                <RecipeDetailView
                    dataSourcesHref="/en/legal/sources"
                    unreachableRetry={idleUnreachableRetry}
                    recipe={makeRecipeDetail({ ingredients: [shape.line] })}
                />,
            );

            const item = lineItem(shape.checkbox);
            const block = item.lastElementChild;
            const name = within(item).getByText(shape.name);

            expect(item.children).toHaveLength(2);
            expect(block?.contains(name)).toBe(true);
            expect(
                block?.textContent?.startsWith(shape.quantity === '' ? shape.name : `${shape.quantity} ${shape.name}`),
            ).toBe(true);

            if (shape.quantity !== '') {
                const quantity = within(item).getByText(shape.quantity);

                expect(block?.contains(quantity)).toBe(true);
                expect(quantity.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            }
        });
    }

    it('starts the text block with the name when the line states no amount', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [makeVariantBoundLine({ quantity: { kind: 'absent' }, unit: undefined })],
                })}
            />,
        );

        const name = screen.getByText('beef brisket');
        const block = name.parentElement;

        expect(block?.textContent?.startsWith('beef brisket')).toBe(true);
        expect(block?.firstElementChild).toBe(name);
    });
});

describe('RecipeDetailView (web) — root-bound beside variant-bound (F3, R28)', () => {
    it('shows the name only on the root-bound line, and every part on the variant-bound line', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeRootBoundLine(), makeVariantBoundLine()] })}
            />,
        );

        const root = lineItem('1 lb beef brisket');
        const variant = lineItem(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);

        expect(within(root).getByText('beef brisket')).toBeTruthy();
        expect(shownParts(root)).toEqual([]);
        expect(root.textContent).not.toContain('·');
        expect(shownParts(variant)).toEqual(PART_TEXTS);
    });

    it('names a root-bound line’s checkbox by its quantity and name alone', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeRootBoundLine({ hasVariants: false })] })}
            />,
        );

        expect(screen.getByRole('checkbox', { name: '1 lb beef brisket' })).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — a line bound to a retired variant (R29)', () => {
    /**
     * The read wire carries no "retired" flag: food stops listing a retired variant, and the line keeps its binding.
     * What this proves is the read view's half of R29: the parts come from the line's OWN binding, never from a list
     * of the root's live variants, so a retired variant still shows its name and every part.
     */
    it('keeps its name and every part, read from the line’s own binding', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeVariantBoundLine({ variant: { id: 'fdc:retired', parts: [...BRISKET_FLAT_HALF_PARTS] } }),
                    ],
                })}
            />,
        );

        const item = lineItem(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);

        expect(within(item).getByText('beef brisket')).toBeTruthy();
        expect(shownParts(item)).toEqual(PART_TEXTS);
    });
});

describe('RecipeDetailView (web) — no comma-joined variant label (origin Success Criteria)', () => {
    it('finds a comma-joined label in the cook’s own notes (the control), and none from the dotted line', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeVariantBoundLine(),
                        // The cook's own words: the detector must find these, or it finds nothing anywhere.
                        makeRootBoundLine({ notes: 'flat half, separable lean and fat' }),
                    ],
                })}
            />,
        );

        const control = lineItem('1 lb beef brisket');
        const variant = lineItem(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);

        expect(commaJoinedTexts(control, BRISKET_FLAT_HALF_PARTS)).toEqual(['flat half, separable lean and fat']);
        expect(commaJoinedTexts(variant, BRISKET_FLAT_HALF_PARTS)).toEqual([]);
        expect(shownParts(variant)).toEqual(PART_TEXTS);
    });
});
