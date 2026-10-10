/**
 * Fixture factory for the canonical parse result (CODING_STANDARDS §7 "Fixture Factories").
 */
import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';

import type { ParsedFood, ParsedLine, ParseProvenance } from '../../parsedLine.js';

/**
 * One engine named every fact — the ordinary case, so a test that cares about provenance says so.
 *
 * ⚠️ Annotated as `ParseProvenance` rather than left inferred so that a fact added to `ParsedFacts` fails
 * to compile HERE too, instead of leaving every fixture silently short one key.
 */
const CRF_THROUGHOUT: ParseProvenance = { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'crf' };

/**
 * A stated exact amount, for a fixture default that is not `absent`.
 *
 * ⛔ Goes through recipe-core's smart constructor rather than a `{ kind: 'exact' }` literal: a fixture that
 * can spell a quantity the real producer cannot would let a test pass against a value that never occurs.
 */
const ONE: IngredientQuantity = statedQuantity(1) ?? ABSENT_QUANTITY;

/**
 * Build a {@link ParsedLine} — a clean, single-food, fully-read line unless overridden.
 *
 * @param overrides - Fields to replace on the default line.
 * @returns A complete parse. Pure.
 */
export function makeParsedLine(overrides: Partial<ParsedLine> = {}): ParsedLine {
    return {
        raw: '1 tablespoon butter',
        statedMeasure: '1 tablespoon',
        quantity: ONE,
        unit: 'tablespoon',
        foods: [{ name: 'butter', prep: null }],
        reviewReasons: [],
        provenance: CRF_THROUGHOUT,
        ...overrides,
    };
}

/**
 * Build one {@link ParsedFood}.
 *
 * @param name - The food's identity, adjectives included (KTD-11b).
 * @param prep - What is done TO the food, or `null` when the line says nothing.
 * @returns The food. Pure.
 */
export function makeParsedFood(name: string, prep: string | null = null): ParsedFood {
    return { name, prep };
}
