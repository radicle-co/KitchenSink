/**
 * `authoredMacrosOf` (ADR-0029 §7): an authored food's four macros, read back out of its LIVE nutrient rows by the exact
 * dictionary identity (`name` AND `unit`) the writer stored them under. Never by a name pattern: `Energy` is stored in
 * `kcal` and `kj` under one name, and only the identity tells them apart.
 */
import { describe, expect, it } from 'vitest';

import { authoredMacrosOf } from '../authoredMacros.js';

const row = (name: string, unit: string, amount: string) => ({ name, unit, amount });

const AUTHORED = [
    row('Energy', 'kcal', '380'),
    row('Protein', 'g', '70'),
    row('Carbohydrate, by difference', 'g', '12.5'),
    row('Total lipid (fat)', 'g', '6'),
];

describe('authoredMacrosOf', () => {
    it('reads each macro by the identity the writer stored it under', () => {
        expect(authoredMacrosOf(AUTHORED)).toStrictEqual({ calories: 380, proteinG: 70, carbsG: 12.5, fatG: 6 });
    });

    it('takes energy from the kcal row, never the kJ row of the same name', () => {
        const rows = [row('Energy', 'kj', '1590'), ...AUTHORED];

        expect(authoredMacrosOf(rows)?.calories).toBe(380);
    });

    it('ignores a row whose name only resembles a macro', () => {
        const rows = [
            row('Protein, total', 'g', '99'),
            row('Energy (atwater general factors)', 'kcal', '999'),
            row('Carbohydrate, available', 'g', '99'),
            row('Fatty acids, total saturated', 'g', '99'),
            ...AUTHORED,
        ];

        expect(authoredMacrosOf(rows)).toStrictEqual({ calories: 380, proteinG: 70, carbsG: 12.5, fatG: 6 });
    });

    it('answers nothing when any of the four is missing: a partial set is not what an author wrote', () => {
        expect(authoredMacrosOf(AUTHORED.slice(1))).toBeUndefined();
        expect(authoredMacrosOf([])).toBeUndefined();
    });
});
