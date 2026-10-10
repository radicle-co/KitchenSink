/**
 * The per-line user-entered nutrition (FR-007a) across its four `numeric` columns, both directions.
 *
 * `pg` hands a `numeric` back as a string, so every reader converts, and an absent figure must stay absent: read as
 * `Number(null)` it would claim the line has zero calories.
 */
import { describe, expect, it } from 'vitest';

import { userNutritionColumns, userNutritionFromColumns } from '../userNutritionColumns.js';

const NONE = { userCalories: null, userProteinG: null, userCarbsG: null, userFatG: null };

describe('userNutritionFromColumns', () => {
    it('reads each stated figure as a number', () => {
        expect(
            userNutritionFromColumns({
                userCalories: '250.500',
                userProteinG: '12.000',
                userCarbsG: '3.250',
                userFatG: '8.000',
            }),
        ).toStrictEqual({ userCalories: 250.5, userProteinG: 12, userCarbsG: 3.25, userFatG: 8 });
    });

    it('⛔ omits a figure the line does not state, never reading it as zero', () => {
        expect(userNutritionFromColumns({ ...NONE, userProteinG: '4.000' })).toStrictEqual({ userProteinG: 4 });
        expect(userNutritionFromColumns(NONE)).toStrictEqual({});
    });

    it('keeps a stated zero, which is a figure and not an absence', () => {
        expect(userNutritionFromColumns({ ...NONE, userFatG: '0.000' })).toStrictEqual({ userFatG: 0 });
    });
});

describe('userNutritionColumns', () => {
    it('writes each stated figure, and null for each one the line does not state', () => {
        expect(userNutritionColumns({ userCalories: 250.5, userFatG: 0 })).toStrictEqual({
            userCalories: '250.5',
            userProteinG: null,
            userCarbsG: null,
            userFatG: '0',
        });
    });

    it('round-trips through the read', () => {
        const stated = { userCalories: 120, userProteinG: 3.5, userCarbsG: 20, userFatG: 1.25 };

        expect(userNutritionFromColumns(userNutritionColumns(stated))).toStrictEqual(stated);
    });
});
