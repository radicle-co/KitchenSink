/**
 * The package door (CODING_STANDARDS §1 "Barrel `index.ts` files MUST contain only named re-exports.
 * `export *` is NOT a named re-export and is therefore prohibited").
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | §1 — the public API is EXPLICIT, so nothing leaks by accident | "exports exactly" |
 *
 * A snapshot of the export names is the only thing that catches an `export *` regression: the barrel
 * would still compile, still pass every other suite, and would silently publish the lexicon, the
 * pre-normalizer's internals and any future private helper as public API — which the `exports` map
 * then makes permanent.
 */
import { describe, it, expect } from 'vitest';

import * as publicApi from '../index.js';

describe('@kitchensink/recipe-import-core barrel', () => {
    it('exports exactly the named public surface, and nothing else', () => {
        // ⚠️ GREW BY TWO IN U7, deliberately. `corruptsStatedValue` and `findQuantityPhrases` are what
        // let `cookbook-import` ask "does this reason mean a wrong number?" and "is this ` and ` part of
        // a number?" without restating this package's own taxonomy or its number lexicon.
        //
        // `normalizeQuantityRange` and `RANGE_SEPARATOR` are deliberately NOT here: they are the internal
        // seam between the grammar and the two scalar normalizers, and nothing outside this package has a
        // use for them. A regex on the public surface would also break the all-exports-are-functions
        // control below, which is worth keeping exactly as strict as it is.
        //
        // ⚠️ GREW BY TWO MORE in U7's second half, and each is answering a question `cookbook-import`
        // cannot answer for itself. `millilitresPerUnit` is how a book's RELATIONAL table ("2 gills = 1
        // cup") becomes a number without restating `parse-ingredient`'s per-system volume table, and
        // `roundToQuantityStorageScale` is the `numeric(10,3)` scale — ONE piece of knowledge that now has
        // a second producer of storable quantities (the historical-unit conversion) and must not be
        // copied into it.
        //
        // ⛔ `HISTORICAL_UNIT_DEFINITIONS` is deliberately NOT here. It is a `parse-ingredient` extension
        // table consumed only by `ingredientLine.ts` inside this package, and publishing it would put a
        // non-function on a surface whose all-exports-are-functions control is worth more than the export.
        //
        // ⚠️ GREW BY ONE on 2026-08-23. `splitMeasurement` divides a measurement phrase into the parts that
        // ADD and the parts that only RESTATE it — the step `normalizeQuantity` cannot take, because it
        // reads the leading quantity and by design sees no second one. It is public because the caller that
        // needs it is the import pipeline, not this package: a measurement arrives already bounded (an LLM
        // or a parser decides where the food begins), and this divides what it is handed.
        // ⚠️ GREW BY ONE in U16, and it is the only RUNTIME export that unit adds. `ParsedLine` is the
        // canonical parse result the two-engine pipeline produces, and `projectToIngredientLine` narrows
        // it to the shape `cookbook-import` already compiles against — the whole point of the unit is
        // that the wide shape is canonical and the narrow one is a documented projection of it, so the
        // narrowing has to be reachable from outside this package or every consumer re-implements it.
        // The contract's TYPES ride on the same barrel and do not appear here: they are erased.
        // ⚠️ GREW BY ONE in U19, and it is that unit's ONLY runtime export. `compareParses` is the pure
        // policy deciding what the merged parse is and what the disagreement was, and its consumer is
        // recipe-workers' parse pipeline (U22) — a DIFFERENT package, reachable only through this door,
        // since the `exports` map publishes nothing but `.`. Its `modifierLexicon` collaborator is
        // deliberately NOT here: KTD-11b's vocabulary is an implementation detail of the comparator, the
        // same way `WHOLE_NUMBER_WORDS` is of the pre-normalizer, and its word sets are not functions.
        // ⚠️ GREW BY TWO in U22's promotion layer, and they are the pair that lets an ENGINE'S output
        // become a `ParsedLine` at all — the step nothing in the tree performed, and without which
        // `compareParses` (which consumes two of them) had no producer but a test fixture. They are public
        // because their callers are the engine adapters in `cookbook-import` and the parse leg in
        // `recipe-workers`, both a different package, and this barrel is the package's only door.
        //
        // ⛔ `readStatedMeasure` is deliberately NOT here. It is the promotions' shared reading of a measure
        // phrase — an implementation detail of exactly these two functions, the same way `modifierLexicon`
        // is of the comparator — and nothing outside this package reads a measure without also promoting a
        // line. It goes on the barrel the day a caller outside needs it, and not before.
        expect(Object.keys(publicApi).sort()).toEqual([
            'compareParses',
            'corruptsStatedValue',
            'findQuantityPhrases',
            'millilitresPerUnit',
            'normalizeDurationToMinutes',
            'normalizeQuantity',
            'normalizeServings',
            'parseIngredientLine',
            'projectToIngredientLine',
            'promoteCrfReading',
            'promoteLlmParse',
            'roundToQuantityStorageScale',
            'sanitizeToPlainText',
            'splitMeasurement',
        ]);
    });

    it('exports every entry point as a function', () => {
        for (const [name, value] of Object.entries(publicApi)) {
            expect(typeof value, `${name} should be a function`).toBe('function');
        }
    });

    it('does not re-export the lexicon, which is an implementation detail of the pre-normalizer', () => {
        expect(Object.keys(publicApi)).not.toContain('WHOLE_NUMBER_WORDS');
        expect(Object.keys(publicApi)).not.toContain('FRACTION_WORD_DENOMINATORS');
    });
});
