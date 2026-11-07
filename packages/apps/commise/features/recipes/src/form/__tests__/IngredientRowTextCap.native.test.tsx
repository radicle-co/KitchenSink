/**
 * The native ingredient row at the largest iOS text size (ADR-0080 §8, designer ruling 2026-11-01): body-sized text
 * grows to 2× its base and no further. The rows drew their texts with raw React Native `Text`, which iOS scales
 * without a cap (a "tbsp" at 40 pt or more, a chip label larger than the amount); the design system's `Text` draws
 * its own size from the capped scale. Each case renders at a system text scale of 3.1, above every cap, and reads the
 * size the text is DRAWN at, so it fails for any text that does not take the cap, by whatever mechanism.
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { nativeTokens } from '@commise/ui/native';
import { renderWithTamagui } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    makeIngredientEntry,
    makeIngredientNutrition,
    makeIngredientRowEditor,
    makeLookupRetry,
    makeRecipeFormValues,
    withLineKeys,
    type UnkeyedFormIngredient,
} from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { IngredientRow } from '../IngredientRow.native.js';
import { ingredientRowViewOf, type IngredientRowContext, type IngredientRowView } from '../ingredientRowView.js';
import type { IngredientLineKey } from '../lineKey.js';
import { recipeFormMessages } from '../messages.js';
import type { RowFocus } from '../useRowFocus.js';

afterEach(cleanup);

const SCALE = 3.1;
const m = recipeFormMessages.en;
const shared = recipeMessages.en;
const BODY_CAP = `${String(nativeTokens.type.body.fontSize * 2)}px`;
const CAPTION_CAP = `${String(nativeTokens.type.caption.fontSize * 2)}px`;

const level = { requested: false, onHandled: () => undefined };
const refusal = { pointed: false, onHandled: () => undefined };
const focus = {
    name: () => level,
    open: () => level,
    actions: () => level,
    trailing: level,
    refusal: { name: () => refusal, trailing: refusal },
    request: vi.fn<RowFocus['request']>(),
    requestTrailing: vi.fn<RowFocus['requestTrailing']>(),
    authoredSheetDismissed: () => false,
} satisfies RowFocus;

const typed: UnkeyedFormIngredient = {
    ingredientId: 'ing_oil',
    foodId: 'food_oil',
    isUserEntered: false,
    name: 'olive oil',
    quantity: 2,
    unit: 'tbsp',
    preparation: 'melted',
    resolutionStatus: FoodResolutionStatus.RESOLVED,
};

/** A line whose food the viewer may not see: the row draws the "Private ingredient" chip. */
const private_: UnkeyedFormIngredient = {
    ingredientId: 'ing_private',
    isUserEntered: false,
    quantity: 2,
    unit: 'tbsp',
    resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
};

function rowOf(line: UnkeyedFormIngredient): IngredientRowView {
    const values = makeRecipeFormValues({ ingredients: withLineKeys([line]) });
    const ctx: IngredientRowContext = {
        values,
        errors: undefined,
        nutrition: makeIngredientNutrition(),
        lookupRetry: makeLookupRetry({ retry: vi.fn(), retrying: new Set() }),
        rowEditor: makeIngredientRowEditor({ entry: makeIngredientEntry() }),
        focus,
        m,
        shared,
        locale: 'en',
        commitCopy: {
            form: m,
            added: shared.ingredientPickerStatus.added,
            details: shared.ingredientDetails,
            remote: shared.ingredientRemoteSearch,
        },
        failureOf: () => undefined,
        alertOf: () => undefined,
        moveOn: vi.fn(),
        lineEditor: {
            openKey: undefined,
            open: vi.fn(),
            close: vi.fn(),
            rangeShown: () => false,
            showRange: vi.fn(),
            hideRange: vi.fn(),
            detailsOpen: false,
            toggleDetails: vi.fn(),
            amountText: (_key: IngredientLineKey) => undefined,
            setAmountText: vi.fn(),
        },
        openFoodDetails: vi.fn(),
        openMoveToGroup: vi.fn(),
        groupCount: 0,
    };
    const [line0] = values.ingredients;

    if (line0 === undefined) {
        throw new Error('the draft has no row');
    }

    return ingredientRowViewOf(line0, 0, ctx);
}

function draw(row: IngredientRowView): void {
    renderWithTamagui(
        <IngredientRow
            row={row}
            m={m}
            entryCopy={{
                form: m,
                search: shared.ingredientSearch,
                pickerSearch: shared.ingredientPickerSearch,
                remote: shared.ingredientRemoteSearch,
                details: shared.ingredientDetails,
                readOffline: offlineNoticeMessages.en.readOffline,
            }}
            panel={() => null}
            inlineEditor={null}
            expanded={undefined}
        />,
        'light',
        SCALE,
    );
}

const sizeOf = (text: string): string => getComputedStyle(screen.getByText(text, { exact: false })).fontSize;

describe('IngredientRow (native) at a system text scale of 3.1', () => {
    it('⛔ draws the amount and food run at 2× body, and the amount no larger than its line', () => {
        draw(rowOf(typed));

        expect(sizeOf('olive oil')).toBe(BODY_CAP);
        expect(sizeOf('2 tbsp')).toBe(BODY_CAP);
    });

    it('⛔ keeps the amount and the food in one text run (#144)', () => {
        draw(rowOf(typed));

        const run = screen.getByText('olive oil', { exact: false });

        expect(run.textContent?.replaceAll(' ', ' ')).toBe('2 tbsp olive oil · melted');
    });

    it('⛔ draws the stand-in amount at 2× body above the chip, and the chip label at 2× its caption', () => {
        draw(rowOf(private_));

        expect(sizeOf('2 tbsp')).toBe(BODY_CAP);
        expect(sizeOf('Private ingredient')).toBe(CAPTION_CAP);
    });

    it('⛔ draws the row’s caption and error lines at 2× caption', () => {
        draw({
            ...rowOf(typed),
            amountInvalidNote: 'Check the amount',
            busyText: 'Choosing a food',
            failure: 'That did not save',
        });

        expect(sizeOf('Check the amount')).toBe(CAPTION_CAP);
        expect(sizeOf('Choosing a food')).toBe(CAPTION_CAP);
        expect(sizeOf('That did not save')).toBe(CAPTION_CAP);
    });
});
