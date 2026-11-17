/**
 * The structural shape of a facts sheet, for a sheet read back from storage.
 *
 * The sheet is kept as jsonb, so the type alone does not hold at runtime: a field can be missing, null or the wrong
 * type. The shape checks types only. Which strings are plain facts, and which values are in range, is for
 * `assertFactsSheetPlain`. Extra properties are allowed here, because the prompt names the fields it reads and ignores
 * the rest.
 */
import { z } from 'zod';

const text = z.string();
const texts = z.array(text);

const factsSheetShape = z.object({
    language: text,
    ingredientNames: texts,
    steps: z.array(
        z.object({
            actions: texts,
            amounts: z.array(z.object({ quantity: z.number(), unit: text.nullable() })),
            temperatures: z.array(z.object({ value: z.number(), scale: text })),
            durations: z.array(z.object({ minSeconds: z.number(), maxSeconds: z.number() })),
            ingredients: texts,
            equipment: texts,
            safety: z.array(z.object({ category: text, facts: texts })),
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

    return path.length === 0
        ? 'sheet'
        : path
              .map((part, i) => (typeof part === 'number' ? `[${part}]` : `${i === 0 ? '' : '.'}${String(part)}`))
              .join('');
}
