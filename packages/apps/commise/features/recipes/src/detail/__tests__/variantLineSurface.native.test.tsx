/**
 * Curated U15 — the NATIVE read view's variant line, through react-native-web (`docs/design/ingredientSpecialization.md`
 * §S1, §S4, §S5; origin F3, R24, R25, R27 to R29). The same set as `variantLineSurface.test.tsx` (§14).
 *
 * On native the dotted line is one `Text` whose accessible name is the parts comma-joined, and whose visible text puts
 * a middle dot between them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render as renderUnscoped, screen, within } from '@testing-library/react';

import { commaJoinedTexts } from '../../__tests__/commaJoinedTexts.js';
import { makeRecipeDetail, idleUnreachableRetry } from '../../__fixtures__/index.js';
import {
    BRISKET_FLAT_HALF_PARTS,
    BRISKET_FLAT_HALF_SPOKEN,
    makeRootBoundLine,
    makeVariantBoundLine,
} from '../__fixtures__/variantLines.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDetailView } from '../RecipeDetailView.native.js';
import { resetServingScale } from '../servingScale.js';
import type { ReactElement } from 'react';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';

/** Every detail renders inside the session’s cook-marks scope, as each app root mounts it. */
const render = (ui: ReactElement): ReturnType<typeof renderUnscoped> =>
    renderUnscoped(ui, { wrapper: CookMarksTestProvider });

afterEach(() => {
    cleanup();
    resetServingScale();
});

/** The checkbox's row: the dotted line, the name and the cook's words sit in it. */
function lineRow(name: string): HTMLElement {
    // The whole row IS the checkbox (build spec §6.3).
    return screen.getByRole('checkbox', { name });
}

describe('RecipeDetailView (native) — a variant-bound line (F1/AE1 display, R25)', () => {
    it('shows the root name, and every part on one dotted line in wire order', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeVariantBoundLine()] })}
            />,
        );

        const row = lineRow(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);
        const line = within(row).getByLabelText(BRISKET_FLAT_HALF_SPOKEN);

        expect(within(row).getByText('beef brisket')).toBeTruthy();
        // U+2011 keeps `1/8-inch` whole on screen; the label keeps the catalog's own hyphen.
        expect(line.textContent).toBe('flat half · separable lean and fat · 1/8‑inch trim · select · braised');
    });

    it('names the checkbox `{quantity} {food}, {parts}`, every part comma-joined for a screen reader (§S5, R27)', () => {
        render(
            <RecipeDetailView
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

    it('puts the dotted line on its own row under the name, BEFORE the cook’s preparation and notes (§S5)', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [makeVariantBoundLine({ preparation: 'sliced thin', notes: 'trim the cap' })],
                })}
            />,
        );

        // The row's name is the whole line, so it ends with the cook's preparation.
        const row = lineRow(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}, sliced thin`);
        const name = within(row).getByText('beef brisket');
        const line = within(row).getByLabelText(BRISKET_FLAT_HALF_SPOKEN);
        const preparation = within(row).getByText('sliced thin');
        const notes = within(row).getByText('trim the cap');

        expect(name.compareDocumentPosition(line)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(line.compareDocumentPosition(preparation)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(preparation.compareDocumentPosition(notes)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        // "Under": the row's text block is a column, so the dotted line takes a line of its own.
        expect(window.getComputedStyle(row.lastElementChild as Element).flexDirection).toBe('column');
    });
});

describe('RecipeDetailView (native) — root-bound beside variant-bound (F3, R28)', () => {
    it('shows the name only on the root-bound line, and every part on the variant-bound line', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeRootBoundLine(), makeVariantBoundLine()] })}
            />,
        );

        const root = lineRow('1 lb beef brisket');
        const variant = lineRow(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);

        expect(within(root).getByText('beef brisket')).toBeTruthy();
        expect(within(root).queryByLabelText(BRISKET_FLAT_HALF_SPOKEN)).toBeNull();
        expect(root.textContent).not.toContain('·');
        expect(within(variant).getByLabelText(BRISKET_FLAT_HALF_SPOKEN)).toBeTruthy();
    });

    it('names a root-bound line’s checkbox by its quantity and name alone', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeRootBoundLine({ hasVariants: false })] })}
            />,
        );

        expect(screen.getByRole('checkbox', { name: '1 lb beef brisket' })).toBeTruthy();
    });
});

describe('RecipeDetailView (native) — a line bound to a retired variant (R29)', () => {
    /** See the web file: the parts come from the line's OWN binding, so a retired variant still shows every part. */
    it('keeps its name and every part, read from the line’s own binding', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeVariantBoundLine({ variant: { id: 'fdc:retired', parts: [...BRISKET_FLAT_HALF_PARTS] } }),
                    ],
                })}
            />,
        );

        const row = lineRow(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);

        expect(within(row).getByText('beef brisket')).toBeTruthy();
        expect(within(row).getByLabelText(BRISKET_FLAT_HALF_SPOKEN)).toBeTruthy();
    });
});

describe('RecipeDetailView (native) — no comma-joined variant label (origin Success Criteria)', () => {
    it('finds a comma-joined label in the cook’s own notes (the control), and none from the dotted line', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeVariantBoundLine(),
                        makeRootBoundLine({ notes: 'flat half, separable lean and fat' }),
                    ],
                })}
            />,
        );

        const control = lineRow('1 lb beef brisket');
        const variant = lineRow(`2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`);

        expect(commaJoinedTexts(control, BRISKET_FLAT_HALF_PARTS)).toEqual(['flat half, separable lean and fat']);
        expect(commaJoinedTexts(variant, BRISKET_FLAT_HALF_PARTS)).toEqual([]);
        expect(within(variant).getByLabelText(BRISKET_FLAT_HALF_SPOKEN)).toBeTruthy();
    });
});
