/**
 * A Matvaretabellen mirror item as an extract line (plan U28, R53, KTD-24): the line the xlsx extractor
 * (`matvaretabellenExtract.ts`) writes for the same food, read from the publisher's JSON. A picked mirror item and a
 * seeded citation therefore hold each value under one definition, and the mirror sync can compare the two.
 *
 * The nutrient list is CLOSED, and each entry names the INFOODS definition the publisher gives it:
 *
 * | JSON                    | Tag          | Definition                                                     |
 * | ----------------------- | ------------ | -------------------------------------------------------------- |
 * | constituent `Fett`      | `FAT`        | fat                                                            |
 * | constituent `Karbo`     | `CHOAVL`     | available carbohydrate (MI0181): starch and sugars, no fibre   |
 * | constituent `Fiber`     | `FIBTG`      | dietary fibre                                                  |
 * | constituent `Protein`   | `PROCNT`     | protein                                                        |
 * | `calories`              | `ENERC_KCAL` | energy in kcal, as published (R53)                             |
 *
 * ⚠️ The kJ `energy` field is deliberately NOT read. On 2026-10-01 332 of its 2,121 values were floating-point tails
 * (`1272.8162236915814`), and 29 of the 66 cited foods differ from the workbook's whole kJ, so it is not a number the
 * publisher prints. Rounding it would be a conversion, which only `basisConversion` makes (KTD-24), and energy is
 * stored in kcal as published.
 *
 * ⚠️ Owed: the step from this line to a `CanonicalCandidate` waits for the citation's dataset (U4), so a picked mirror
 * item can cite its source as a seeded one does (plan R59).
 *
 * @pattern Adapter — the publisher's JSON shape to the extract line every cited source shares
 * @module
 */
import { z } from 'zod';

import type { ExtractLine } from '../../foods/seed/archive/sourceExtract.js';
import { isExtractDecimal } from '../../foods/seed/archive/sourceExtract.js';
import { INFOODS, type InfoodsTag } from '../../foods/nutrition/nutrientIdentity.js';
import { AdapterValidationError } from '../foodSource.errors.js';
import type { MirrorItem } from '../mirror/mirrorFeed.js';

const SOURCE = 'matvaretabellen';

/** Each constituent read: its id in the JSON, the unit it must be published in, and its definition's tag. */
const CONSTITUENTS = [
    { nutrientId: 'Fett', unit: 'g', tag: INFOODS.fat },
    { nutrientId: 'Karbo', unit: 'g', tag: INFOODS.carbohydrateAvailable },
    { nutrientId: 'Fiber', unit: 'g', tag: INFOODS.fibre },
    { nutrientId: 'Protein', unit: 'g', tag: INFOODS.protein },
] as const;

/** The food's energy in kcal, published as its own field rather than as a constituent. */
const CALORIES = { field: 'calories', unit: 'kcal', tag: INFOODS.energyKcal } as const;

/** Every tag the mirror reads, for a caller that compares a mirror line with the committed extract's. */
export const MATVARETABELLEN_MIRROR_TAGS: readonly InfoodsTag[] = [
    ...CONSTITUENTS.map((each) => each.tag),
    CALORIES.tag,
];

const amountSchema = z.looseObject({ quantity: z.number().nullable().optional(), unit: z.string().optional() });

const payloadSchema = z.looseObject({
    calories: amountSchema,
    constituents: z.array(amountSchema.extend({ nutrientId: z.string() })),
});

/** One published amount. */
type Amount = z.infer<typeof amountSchema>;

/**
 * One amount as an extract value. Pure.
 *
 * @param amount - The published amount.
 * @param unit - The unit it must be published in.
 * @param key - The food, for a rejection.
 * @param field - The JSON field, for a rejection.
 * @returns The value as a plain decimal, or `undefined` when the table states none.
 * @throws {AdapterValidationError} when the amount is in another unit, negative, or not a decimal of at most three
 *   places.
 */
function valueOf(amount: Amount, unit: string, key: string, field: string): string | undefined {
    if (amount.quantity === null || amount.quantity === undefined) {
        return undefined;
    }

    if (amount.unit !== unit) {
        throw new AdapterValidationError(SOURCE, key, field, `is published in '${amount.unit ?? ''}', not '${unit}'`);
    }

    const text = String(amount.quantity);

    if (!isExtractDecimal(text)) {
        throw new AdapterValidationError(SOURCE, key, field, `${text} is not a plain decimal of at most three places`);
    }

    return text;
}

/**
 * A mirror item's extract line. Pure.
 *
 * @param item - A Matvaretabellen mirror item.
 * @returns The line, per 100 g, with the closed list's values the table states.
 * @throws {AdapterValidationError} naming the field, when the payload is not the shape, a read constituent is listed
 *   twice, or an amount is not one the extract can hold.
 */
export function matvaretabellenExtractLine(item: MirrorItem): ExtractLine {
    const key = item.externalKey;
    const parsed = payloadSchema.safeParse(item.payload);

    if (!parsed.success) {
        const [issue] = parsed.error.issues;

        throw new AdapterValidationError(
            SOURCE,
            key,
            String(issue?.path[0] ?? 'payload'),
            'is not the published shape',
        );
    }

    const values: Partial<Record<InfoodsTag, string>> = {};

    for (const constituent of CONSTITUENTS) {
        const listed = parsed.data.constituents.filter((each) => each.nutrientId === constituent.nutrientId);

        if (listed.length > 1) {
            throw new AdapterValidationError(SOURCE, key, constituent.nutrientId, 'is listed more than once');
        }

        const [amount] = listed;
        const value = amount === undefined ? undefined : valueOf(amount, constituent.unit, key, constituent.nutrientId);

        if (value !== undefined) {
            values[constituent.tag] = value;
        }
    }

    const kcal = valueOf(parsed.data.calories, CALORIES.unit, key, CALORIES.field);

    if (kcal !== undefined) {
        values[CALORIES.tag] = kcal;
    }

    return { key, name: item.name, basis: 'per100g', values };
}
