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
        //
        // ⚠️ GREW BY TWO in U22a, and they are two VIEWS of one lexicon rather than two lexicons.
        // `segmentClause` bounds an accepted span at the end of its ingredient — refusing the cut when the
        // tail is a second food — and `dropTrailingInstruction` applies the same boundary to a NAME, whose
        // single field has nowhere to keep a second food and so is cut unconditionally. Both are public
        // because the consumer is `cookbook-import`, a different package reachable only through this door.
        // The `VESSELS` and `INSTRUCTION_BOUNDARY` word sets behind them are deliberately NOT here, for
        // the reason `modifierLexicon`'s are not: a vocabulary is an implementation detail of the policy
        // that consumes it, and neither is a function.
        //
        // ⚠️ GREW BY ONE MORE in U22a's review pass, and it is the exception that proves that rule.
        // `measuresNoSubstance` is a PREDICATE over `notAFoodLexicon`'s word set, not the set — and it is
        // public because `cookbook-import`'s accept gate ("a DIMENSION is not a measure of an
        // ingredient") and this package's segmentation guard must never disagree about which words those
        // are. The gate used to hold its own `NOT_A_MEASURE` copy; the guard needed the same vocabulary
        // to tell `for five minutes` from `with two eggs`, and two copies across a package boundary is
        // exactly the drift the DRY rule is about.
        //
        // ⚠️ `namesEquipment` and `namesNoFood` JOINED IT on 2026-08-26, and the entry above no longer says
        // `namesNoFood` stays private — the reason it gave ("only the segmenter asks it") stopped being
        // true. `cookbook-import`'s prompt bake-off counts how often a model files a VESSEL or a DURATION
        // under `foods`, which is the same question this vocabulary already answers, asked of a different
        // input. It is admitted for `measuresNoSubstance`'s reason verbatim: the alternative is a second
        // vessel list in the harness, and a second list cannot be told that this one has grown.
        //
        // ⛔ The VOCABULARY is still private. `VESSELS` and `NOT_A_MEASURE` are not exported and the control
        // below would refuse them anyway — what crosses this door is a question with an answer, never a word
        // list. `mentionsAVessel` and `lastWordOf` also stay off it: the first carries a precondition only
        // `clauseSegmentation.ts` can satisfy, and the second is a tokenizer.
        //
        // ⚠️ GREW BY THREE in U22's phase 4 — the orchestration — and two of them are NOT functions, which
        // is why the control below was AMENDED rather than left alone. `runParsePipeline` is the order
        // (correction, then cache, then both engines together); `NO_CACHE` and `NO_CORRECTIONS` are Null
        // Objects, and a consumer with no database must be able to say so EXPLICITLY, because every port on
        // `ParsePipelineDeps` is required (KTD-18) precisely so that a forgotten tier is a compile error
        // rather than a silently degraded pipeline. Publishing the run without them would leave that
        // consumer with no legal way to construct one. See the amended control below for why admitting them
        // does not weaken it.
        //
        // ⛔ `cachedFactsOf`, `readCachedParseFacts`, `rehydrateEngineParse` and `cachedParseFactsSchema`
        // are deliberately NOT here, for the reason `readStatedMeasure` is not: they are how the PIPELINE
        // reads and writes a cache row, and the cache ADAPTER behind `ParseCachePort` never touches them —
        // it stores the payload it is handed and returns the payload it read, as `unknown`. Putting the
        // schema on the door would also put a non-function there for no caller at all.
        expect(Object.keys(publicApi).sort()).toEqual([
            'NO_CACHE',
            'NO_CORRECTIONS',
            'compareParses',
            'corruptsStatedValue',
            'dropTrailingInstruction',
            'findQuantityPhrases',
            'measuresNoSubstance',
            'millilitresPerUnit',
            'namesEquipment',
            'namesNoFood',
            'normalizeDurationToMinutes',
            'normalizeQuantity',
            'normalizeServings',
            'parseIngredientLine',
            'projectToIngredientLine',
            'promoteCrfReading',
            'promoteLlmParse',
            'roundToQuantityStorageScale',
            'runParsePipeline',
            'sanitizeToPlainText',
            'segmentClause',
            'splitMeasurement',
        ]);
    });

    /**
     * The two Null Objects U22 publishes, named here so the control below stays a CLOSED exception.
     *
     * ⛔ Adding a name to this list is a decision, not a formality: everything else on this door is
     * behaviour, and the moment a plain constant or a regex is admitted "because the list already has
     * exceptions" the control has stopped meaning anything. `HISTORICAL_UNIT_DEFINITIONS`, `VESSELS` and
     * `modifierLexicon`'s word sets were all kept OFF the barrel rather than added here.
     */
    const NULL_OBJECT_EXPORTS: readonly string[] = ['NO_CACHE', 'NO_CORRECTIONS'];

    it('exports every entry point as a function, or as a Null Object whose every member is one', () => {
        // ⚠️ AMENDED in U22, and STRENGTHENED in the same edit rather than merely relaxed. The original
        // rule — "every export is a function" — kept data off the door, and the reason it is worth having
        // is that a value on a package's public surface is a value every consumer can come to depend on
        // and nothing can evolve. A Null Object is not that: it is an IMPLEMENTATION of a published port,
        // carrying no state and no data, and `ParsePipelineDeps` requiring every port (KTD-18) is exactly
        // what makes it necessary rather than convenient.
        //
        // So the exception is narrow and it pays for itself: an admitted export must be one of the two
        // NAMED Null Objects, every one of its own members must be a function, and it must be FROZEN — so
        // "no data on this door" still holds, and a consumer cannot reassign a method on a singleton every
        // other consumer shares.
        for (const [name, value] of Object.entries(publicApi)) {
            if (NULL_OBJECT_EXPORTS.includes(name)) {
                expect(Object.isFrozen(value), `${name} should be frozen`).toBe(true);

                for (const [member, implementation] of Object.entries(value as unknown as Record<string, unknown>)) {
                    expect(typeof implementation, `${name}.${member} should be a function`).toBe('function');
                }

                continue;
            }

            expect(typeof value, `${name} should be a function`).toBe('function');
        }
    });

    it('does not re-export the lexicon, which is an implementation detail of the pre-normalizer', () => {
        expect(Object.keys(publicApi)).not.toContain('WHOLE_NUMBER_WORDS');
        expect(Object.keys(publicApi)).not.toContain('FRACTION_WORD_DENOMINATORS');
    });
});
