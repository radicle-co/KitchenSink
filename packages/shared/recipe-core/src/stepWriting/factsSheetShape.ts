/**
 * The shape of a facts sheet, for a sheet read back from storage, tied to the `FactsSheet` type by annotation so a new
 * field fails to compile until the shape names it.
 *
 * The sheet is kept as jsonb, so the type alone does not hold at runtime: a field can be missing, null or the wrong
 * type, and an enum can hold another value. Which strings are plain facts, and that a duration is not negative or
 * backwards, is for `toPlainFactsSheet`. Quantities and temperatures are not range checked. Extra properties are allowed here, because `toPlainFactsSheet` rebuilds the sheet from the named
 * fields and drops the rest.
 */
import { z } from 'zod';

import { SAFETY_CATEGORIES } from './factsSheet.types.js';

import type { FactsSheet } from './factsSheet.types.js';

const text = z.string();
const texts = z.array(text);

const factsSheetShape: z.ZodType<FactsSheet> = z.object({
    language: text,
    ingredientNames: texts,
    steps: z.array(
        z.object({
            actions: texts,
            amounts: z.array(z.object({ quantity: z.number(), unit: text.nullable() })),
            temperatures: z.array(z.object({ value: z.number(), scale: z.enum(['C', 'F']) })),
            durations: z.array(z.object({ minSeconds: z.number(), maxSeconds: z.number() })),
            ingredients: texts,
            equipment: texts,
            safety: z.array(z.object({ category: z.enum(SAFETY_CATEGORIES), facts: texts })),
        }),
    ),
});

/**
 * The path of the first field with the wrong type, spelt as `steps[0].amounts[1].unit`.
 *
 * @param sheet - A value that should be a facts sheet.
 * @returns The path, `'sheet'` when the value is not an object at all, or `null` when the shape holds. Pure.
 */
export function firstShapeFault(sheet: unknown): string | null {
    const parsed = factsSheetShape.safeParse(sheet);

    if (parsed.success) {
        return null;
    }

    const path = parsed.error.issues[0]?.path ?? [];

    return path.length === 0 ? 'sheet' : z.core.toDotPath(path);
}
