import { MAX_PARSE_PROMPT_CHARS, PARSE_MAX_OUTPUT_TOKENS } from '@kitchensink/recipe-core/parsing/parse-prompt';
import { namesEquipment } from '@kitchensink/recipe-import-core';
import { readFileSync } from 'node:fs';

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { compareParses } from '../parseAgreement.js';
import type { CrfParse } from '../crfParse.js';
import { classifyParseResponse } from '../parseResponse.js';
import {
    PARSE_VARIANT_IDS,
    PARSE_VARIANT_V1,
    PARSE_VARIANT_V2,
    PARSE_VARIANT_V3,
    PARSE_VARIANT_V4,
    PARSE_VARIANT_V5,
    PARSE_VARIANT_V6,
    buildVariantPrompt,
    resolveParseVariant,
    statedUnitOf,
} from '../promptVariant.js';
import { OWNER_PROMPT_PATH } from '../promptVariant.js';

/**
 * The four arms of the prompt bake-off.
 *
 * The assertions here are the ones that decide whether the RUN means anything, not stylistic checks on the
 * wording. Five properties carry the whole comparison:
 *
 *  1. **v1 is the shipped prompt by reference**, not a transcription. A copy would drift and the baseline
 *     column would silently stop being the baseline.
 *  2. **Each arm judges responses against ITS OWN declared shape.** Measuring v2 against v1's `strictObject`
 *     files every well-formed v2 answer as `wrongShape`, which reads as a catastrophic prompt failure and is
 *     entirely a schema artefact — the single most likely way to get a wrong answer out of this experiment.
 *  3. **Every arm projects into ONE vocabulary**, so the CRF comparator, the non-food census and the cost
 *     arithmetic are shared rather than reimplemented per arm.
 *  4. **v3's unit is the model's claim, v1's, v2's and v4's is our derivation.** The projection must actually
 *     carry that difference, or the report's caveat would be describing machinery that is not there.
 *  5. **v4 is v1's two kept sentences plus v2's drain**, and both halves are asserted against the arms they
 *     were taken from rather than against a transcription. v4 exists BECAUSE v2 deleted one of those
 *     sentences and lost 3.2pp of `names` agreement on lines the drain cannot touch (report §15.7); a v4
 *     that quietly reworded it would re-run v2 under a new name and the four-arm table could not say so.
 *     ⚠️ The run came back NEGATIVE (§16) — which is exactly why the derivation matters: a null result is
 *     only worth reading if the restored text is provably the deleted text.
 */
function crf(overrides: Partial<CrfParse> = {}): CrfParse {
    return {
        sentence: 'x',
        measure: '',
        names: [],
        size: null,
        preparation: null,
        comment: null,
        ...overrides,
    };
}

describe('the arm registry', () => {
    it('resolves every declared id', () => {
        for (const id of PARSE_VARIANT_IDS) {
            expect(resolveParseVariant(id).id).toBe(id);
        }
    });

    it('REFUSES an unknown id rather than falling back to the baseline', () => {
        // ⛔ A silent fallback would produce a four-column report whose columns are the same prompt, and
        // nothing in the output would say so.
        //
        // ⚠️ This assertion has now been rewritten TWICE, for the same reason each time: it named `v4`,
        // then `v5`, then `v6`, and each became a REAL arm. Rewritten rather than deleted — the behaviour it
        // proves, that an unknown id throws instead of defaulting, is unchanged, and the id was only ever an
        // example of one. `v7` is the next unclaimed id; `1` and `V1` cover the near-misses a typo produces.
        expect(() => resolveParseVariant('v7')).toThrow(/not one of/);
        expect(() => resolveParseVariant('V1')).toThrow(/not one of/);
        expect(() => resolveParseVariant('1')).toThrow(/not one of/);
        expect(() => resolveParseVariant('')).toThrow(/not one of/);
    });

    it('lets NO arm name a vessel word, so the headline is not measuring an enumeration', () => {
        // ⛔ The headline scores `foods` against `notAFoodLexicon`'s vessel set. An arm that listed
        // `bowl`/`pan`/`sieve` would be teaching the model the detector's own vocabulary, and its
        // improvement would be partly a measurement of the enumeration rather than of the drain.
        //
        // ⛔ ASKED OF THE LEXICON, not of a hand-typed list. Two hand-typed lists had already drifted apart
        // (v2's omitted `mortar` and `oven`), and neither covered more than a fifth of `VESSELS` — so a
        // reword to `…rather than eats, such as a dish or a pot.` passed every assertion while handing the
        // model two words the detector scores against. `notAFoodLexicon`'s own docstring rules on this:
        // what crosses its barrel is a QUESTION with an answer, never a word list.
        //
        // ⚠️ `namesEquipment` is head-final, so a single word is its own last word and the fold is exact.
        // ⛔ REWRITTEN, not relaxed — v6 BREAKS this guarantee and the break is a FINDING, not a nuisance.
        // The owner's prompt illustrates its equipment slot with `(e.g., 'skillet', 'bowl')`, which are two
        // words `notAFoodLexicon` scores against. So v6's vessel-drain figure is partly a measurement of
        // that enumeration and must be discounted by it in any report. The exception is pinned WORD FOR
        // WORD rather than waived: a third vessel word appearing later is a new fact and fails here.
        const ENUMERATING_ARMS: Readonly<Record<string, readonly string[]>> = { v6: ["'skillet'", "'bowl')"] };

        for (const id of PARSE_VARIANT_IDS) {
            const named = resolveParseVariant(id)
                .systemPrompt.split(/[\s,.;:"{}[\]|]+/u)
                .filter((word) => word !== '' && namesEquipment(word));

            expect(named, `arm ${id} enumerates vessel words`).toEqual(ENUMERATING_ARMS[id] ?? []);
        }
    });

    it('asks a question that can actually answer yes, so the check above is not vacuous', () => {
        // ⛔ Anti-vacuity for the assertion above: if `namesEquipment` refused every token the loop feeds it,
        // every arm would pass for the wrong reason and the discipline would be unguarded.
        expect(namesEquipment('bowl')).toBe(true);
        expect(namesEquipment('sieve')).toBe(true);
        expect('a bowl or a sieve'.split(/[\s,.;:"{}[\]|]+/u).filter((w) => w !== '' && namesEquipment(w))).toEqual([
            'bowl',
            'sieve',
        ]);
    });

    it('gives every arm a distinct system prompt', () => {
        const prompts = new Set(PARSE_VARIANT_IDS.map((id) => resolveParseVariant(id).systemPrompt));

        expect(prompts.size).toBe(PARSE_VARIANT_IDS.length);
    });
});

describe('v1 — the baseline', () => {
    it('IS the shipped constant, by reference and not by transcription', () => {
        // ⚠️ WAS `toBe(PARSE_VARIANT_V1.systemPrompt)`. The shipped prompt moved on 2026-08-27; this arm is the
        // HISTORICAL baseline every recorded figure was measured against, so it is pinned by its own
        // digest instead. See the arm's docstring for why by-reference inverted.
        expect(Buffer.byteLength(PARSE_VARIANT_V1.systemPrompt, 'utf8')).toBe(511);
        expect(createHash('sha256').update(PARSE_VARIANT_V1.systemPrompt, 'utf8').digest('hex')).toBe(
            '4ea63a78ced3440fa51c757afd5af2af86ce15653cc5c6dca22dd452f06fd33e',
        );
    });

    it('derives its unit rather than taking one the model stated', () => {
        expect(PARSE_VARIANT_V1.unitSource).toBe('derived');
    });

    it('accepts the shipped answer document', () => {
        const answer = PARSE_VARIANT_V1.readAnswer({ measure: 'one cup', foods: [{ name: 'flour', prep: null }] });

        expect(answer.ok).toBe(true);
        expect(answer.ok && answer.parse.statedUnit).toBeUndefined();
    });

    it('REJECTS a document carrying an equipment slot it never asked for', () => {
        const answer = PARSE_VARIANT_V1.readAnswer({ measure: 'one cup', equipment: null, foods: [] });

        expect(answer.ok).toBe(false);
    });
});

describe('v2 — equipment as a drain', () => {
    it('drops the greedy "several words name one food" sentence the hypothesis blames', () => {
        expect(PARSE_VARIANT_V1.systemPrompt).toContain('Several words may together name one food');
        expect(PARSE_VARIANT_V2.systemPrompt).not.toContain('Several words may together name one food');
    });

    it('declares an equipment slot in the answer shape it prints', () => {
        expect(PARSE_VARIANT_V2.systemPrompt).toContain('"equipment"');
    });

    it('accepts its own document, which v1 would have called wrongShape', () => {
        const document = { measure: 'one cup', equipment: 'a bowl', foods: [{ name: 'flour', prep: null }] };

        expect(PARSE_VARIANT_V2.readAnswer(document).ok).toBe(true);
        expect(PARSE_VARIANT_V1.readAnswer(document).ok).toBe(false);
    });

    it('accepts a null equipment, because a line naming no equipment is the common case', () => {
        expect(PARSE_VARIANT_V2.readAnswer({ measure: '', equipment: null, foods: [] }).ok).toBe(true);
    });

    it('spells `measure` exactly as v1 does, so the known benign `null` cancels out of the comparison', () => {
        expect(PARSE_VARIANT_V2.readAnswer({ measure: null, equipment: null, foods: [] }).ok).toBe(false);
        expect(PARSE_VARIANT_V1.readAnswer({ measure: null, foods: [] }).ok).toBe(false);
    });

    it('DISCARDS the equipment value rather than projecting it anywhere', () => {
        const answer = PARSE_VARIANT_V2.readAnswer({
            measure: 'one cup',
            equipment: 'a large mixing bowl',
            foods: [{ name: 'flour', prep: null }],
        });

        expect(answer.ok).toBe(true);
        // ⛔ The slot's whole job is to stop `foods` being the only container. If it reached the reading,
        // v2 would be a different pipeline as well as a different prompt.
        expect(answer.ok && answer.parse.foods.map((food) => food.name)).toEqual(['flour']);
        expect(answer.ok && answer.parse.statedUnit).toBeUndefined();
    });

    it('still derives its unit from the measure phrase', () => {
        expect(PARSE_VARIANT_V2.unitSource).toBe('derived');
    });
});

describe('v3 — full slots', () => {
    it('takes the unit the model states rather than deriving one', () => {
        expect(PARSE_VARIANT_V3.unitSource).toBe('model-stated');

        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: 'two',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        });

        expect(answer.ok && answer.parse.statedUnit).toBe('cups');
    });

    it('records a stated ABSENCE of a unit as an empty string, never as "derive it yourself"', () => {
        // ⛔ `undefined` and `''` are different answers. An arm WITH a unit slot that answered "none" has
        // made a reading; collapsing it onto `undefined` would silently re-derive the unit from the phrase
        // on exactly the lines where the model disagreed with our derivation.
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: 'a pinch',
            equipment: null,
            prep: null,
            units: null,
            foods: ['salt'],
        });

        expect(answer.ok && answer.parse.statedUnit).toBe('');
        expect(statedUnitOf(null)).toBe('');
        expect(statedUnitOf('  cups  ')).toBe('cups');
    });

    it('projects its bare food names into the common {name, prep} vocabulary', () => {
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: 'two',
            equipment: null,
            prep: 'chopped',
            units: null,
            foods: ['onions', 'carrots'],
        });

        // Top-level `prep` replicates onto every food. `judgePrep` compares SETS of non-empty preparations,
        // so one clause replicated twice and the same clause stated once are the same value.
        expect(answer.ok && answer.parse.foods).toEqual([
            { name: 'onions', prep: 'chopped' },
            { name: 'carrots', prep: 'chopped' },
        ]);
    });

    it('rejects v1’s and v2’s documents, and they reject its own', () => {
        const v3Document = { measurements: '', equipment: null, prep: null, units: null, foods: [] };

        expect(PARSE_VARIANT_V3.readAnswer(v3Document).ok).toBe(true);
        expect(PARSE_VARIANT_V1.readAnswer(v3Document).ok).toBe(false);
        expect(PARSE_VARIANT_V2.readAnswer(v3Document).ok).toBe(false);
        expect(PARSE_VARIANT_V3.readAnswer({ measure: '', foods: [] }).ok).toBe(false);
    });

    it('opens with the role framing the owner asked to be measured', () => {
        expect(PARSE_VARIANT_V3.systemPrompt.startsWith('You are an experienced chef')).toBe(true);
    });
});

describe('v4 — the drain WITHOUT the deletion', () => {
    /**
     * The two sentences v2 deleted and v4 restores, taken from the SHIPPED prompt rather than retyped.
     *
     * ⛔ Sliced, not transcribed. A hand-copied expectation is a second copy of a measured artifact: it
     * would keep passing after someone reworded either the shipped prompt or v4, and the report's claim
     * that v4 "keeps v1's sentence exactly as it is" would quietly stop being true. Taking the run from
     * `PARSE_VARIANT_V1.systemPrompt` means the assertion fails if EITHER side moves — which is the point.
     */
    const KEPT_RUN = PARSE_VARIANT_V1.systemPrompt.slice(
        PARSE_VARIANT_V1.systemPrompt.indexOf('Several words'),
        PARSE_VARIANT_V1.systemPrompt.indexOf('tells the cook to do.') + 'tells the cook to do.'.length,
    );

    /** v2's framing paragraph, v2's drain sentence and v2's answer block — sliced, for the same reason. */
    const OPENING = PARSE_VARIANT_V2.systemPrompt.slice(0, PARSE_VARIANT_V2.systemPrompt.indexOf('\n\n'));
    const DRAIN_SENTENCE = PARSE_VARIANT_V2.systemPrompt.slice(
        PARSE_VARIANT_V2.systemPrompt.indexOf('Put in equipment'),
        PARSE_VARIANT_V2.systemPrompt.indexOf('rather than eats.') + 'rather than eats.'.length,
    );
    const ANSWER_BLOCK = PARSE_VARIANT_V2.systemPrompt.slice(PARSE_VARIANT_V2.systemPrompt.indexOf('Answer with this'));

    /**
     * The one genuinely NEW text in v4 — and, measured, the clause that decided the arm.
     *
     * ⚠️ A literal, correctly: it is borrowed from nothing, so there is nothing to slice it out of. §16.6
     * measures what it did — Nova Micro reads *"Every entry in foods must name a food"* as a substance test
     * and withholds `water`, `salt`, `butter` and `brandy`. Pinned here so a fifth arm that deletes the
     * first sentence and keeps only the second has to change this constant deliberately.
     */
    const EMPTY_CASE =
        'Every entry in foods must name a food; when the line names none, answer with an\nempty foods list.';

    it('carries v1’s kept sentences byte for byte, INCLUDING the newline inside them', () => {
        // ⛔ THE WHOLE REASON v4 EXISTS. §15.7 attributed 86 of v2's 87 agreement losses to deleting this
        // run, on lines the equipment slot cannot have touched. A v4 that reworded or re-wrapped it would
        // be a third unattributable arm rather than the controlled repair the report asked for.
        //
        // ⚠️ The measurement came back NEGATIVE (§16.8) — restoring the run bought no agreement at all. The
        // assertion stays exactly as strong: a negative result is only readable if the thing that was
        // restored is provably the thing that was deleted.
        expect(KEPT_RUN).toContain('Several words may together name one food');
        expect(KEPT_RUN).toContain('Put in prep only what the line');
        expect(PARSE_VARIANT_V4.systemPrompt).toContain(KEPT_RUN);
        expect(PARSE_VARIANT_V2.systemPrompt).not.toContain(KEPT_RUN);
    });

    it('carries v2’s drain sentence and v2’s declared document, byte for byte', () => {
        // ⛔ DERIVED FROM v2, not retyped, for the same reason KEPT_RUN is derived from v1: these are the
        // halves whose EFFECT the four-arm table attributes, so they must be the SAME BYTES on both arms,
        // and a hand-copied literal would keep passing after either arm was reworded.
        expect(PARSE_VARIANT_V4.systemPrompt).toContain(DRAIN_SENTENCE);
        expect(PARSE_VARIANT_V4.systemPrompt).toContain(ANSWER_BLOCK);
        // Anti-vacuity: the slices are real sentences, not empty strings produced by a failed `indexOf`.
        expect(DRAIN_SENTENCE).toBe('Put in equipment anything the line names that a cook uses rather than eats.');
        expect(ANSWER_BLOCK).toContain('"equipment":string|null');
    });

    it('opens with v2’s first paragraph, so the drain arms differ only after it', () => {
        expect(PARSE_VARIANT_V4.systemPrompt.startsWith(OPENING)).toBe(true);
        // ⚠️ That opening is v1's with one noun phrase inserted — the only change v1 → v2 → v4 make to the
        // MEANING of the framing. It is not byte-identical to v1's: inserting text at a fixed column moves
        // the wrap points too (v1's paragraph is 106/105/64 characters, v2's and v4's 106/106/87), which is
        // inherent and is why this asserts the noun phrase rather than a diff.
        expect(OPENING).toContain('classifying what it says into the');
        expect(OPENING).toContain('the equipment it names and the foods it names');
        expect(PARSE_VARIANT_V1.systemPrompt).not.toContain('the equipment it names');
    });

    it('is EXACTLY v2’s opening, v2’s drain, v1’s kept pair and the empty case — and nothing else', () => {
        // ⛔ THE PIN THAT MAKES "nothing else moves" AN ASSERTION RATHER THAN A DOCSTRING CLAIM. Every
        // `toContain` above passes with a stray extra sentence anywhere in the prompt; this composes v4 out
        // of the pieces it claims to be made of and demands byte equality. Only `EMPTY_CASE` is a literal,
        // because it is the one genuinely new text in the arm — everything else is taken from the arm it
        // was borrowed from.
        expect(PARSE_VARIANT_V4.systemPrompt).toBe(
            `${OPENING}\n\n${DRAIN_SENTENCE}\n${KEPT_RUN} ${EMPTY_CASE}\n\n${ANSWER_BLOCK}`,
        );
    });

    it('tells the model a line naming no food answers with an EMPTY list, not a nameless entry', () => {
        // The specific defect v4 exists to repair: v2 produced `"name": null` on 66 lines against v1's 6
        // (report §15.4), because the drain took the vessel and left a nameless entry behind. Measured,
        // v4 drove it to ZERO — and §16.6 records what the same clause cost.
        expect(PARSE_VARIANT_V4.systemPrompt).toContain(EMPTY_CASE);
        expect(PARSE_VARIANT_V2.systemPrompt).not.toContain('empty foods list');
        expect(PARSE_VARIANT_V1.systemPrompt).not.toContain('empty foods list');
    });

    it('never says the word "null" in PROSE, only inside the JSON document it prints', () => {
        // ⛔ v3 wrote the literal four-character string `"null"` into its nullable slots 227 times and v2 37
        // (report §15.10) — schema-compliant and semantically wrong, the one failure a shape census cannot
        // see. v4's empty-case clause is therefore worded WITHOUT the word, and this asserts it stays that
        // way: the only `null` in the prompt is the type in the shape line.
        const prose = PARSE_VARIANT_V4.systemPrompt.split('\n').filter((line) => !line.startsWith('{"measure"'));

        expect(prose.join('\n')).not.toContain('null');
    });

    it('is judged by the SAME reader as v2, because it declares the same document', () => {
        // ⛔ One judge for one declared shape. If v2 and v4 were read by two schemas that happened to agree
        // today, a later edit to one would show up in the report as a prompt effect — the exact schema
        // artefact the v1-vs-v2 comparison had to be protected from.
        expect(PARSE_VARIANT_V4.readAnswer).toBe(PARSE_VARIANT_V2.readAnswer);
    });

    it('accepts the drain document, which v1 and v3 both refuse', () => {
        const document = { measure: 'one cup', equipment: 'a bowl', foods: [{ name: 'flour', prep: null }] };

        expect(PARSE_VARIANT_V4.readAnswer(document).ok).toBe(true);
        expect(PARSE_VARIANT_V1.readAnswer(document).ok).toBe(false);
        expect(PARSE_VARIANT_V3.readAnswer(document).ok).toBe(false);
    });

    it('still REFUSES a nameless food, so the defect it targets stays visible in the census', () => {
        // ⛔ v4 repairs `"name": null` in the PROMPT, never by widening the schema. Admitting it here would
        // move v4's compliance up by absorbing the failure instead of fixing it, and the four-arm table's
        // empty-name column — the whole point of this arm — would read zero for the wrong reason.
        // L00146 verbatim, as v2 answered it: `pound in a mortar` → the vessel drained, a nameless entry left.
        expect(
            PARSE_VARIANT_V4.readAnswer({
                measure: 'pound',
                equipment: 'mortar',
                foods: [{ name: null, prep: 'in a mortar' }],
            }).ok,
        ).toBe(false);
        // ⚠️ An EMPTY name is a different failure and is deliberately still SHAPE-VALID: production's
        // `normalizeParseAnswer` drops it, so it never reaches a cook, and `classifyFoodName` files it as an
        // absent food rather than a non-food one. Refusing it here would merge two defects into one number.
        expect(
            PARSE_VARIANT_V4.readAnswer({ measure: 'pound', equipment: 'mortar', foods: [{ name: '', prep: null }] })
                .ok,
        ).toBe(true);
    });

    it('DISCARDS the equipment value and derives its unit, exactly as v2 does', () => {
        const answer = PARSE_VARIANT_V4.readAnswer({
            measure: 'half full',
            equipment: 'stew-pan',
            foods: [{ name: 'boiling water', prep: null }],
        });

        expect(PARSE_VARIANT_V4.unitSource).toBe('derived');
        expect(answer.ok && answer.parse.foods.map((food) => food.name)).toEqual(['boiling water']);
        expect(answer.ok && answer.parse.statedUnit).toBeUndefined();
    });
});

describe('the stated unit reaches the CRF comparison', () => {
    it('uses the model’s unit, not one read out of the measure phrase', () => {
        // The CRF read `2` and no unit; v3 says the unit is `cups`. The comparator must see `cup`.
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: '2',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        });

        expect(answer.ok).toBe(true);

        const agreement = answer.ok
            ? compareParses(answer.parse, crf({ measure: '2 cups', names: ['flour'] }))
            : undefined;

        // ⛔ Would be `crfUnitAbsent`/`unitDiffers` if the stated unit were dropped: the measure PHRASE `2`
        // yields no unit at all.
        expect(agreement?.measure).toBe('agree');
    });

    it('does not read a unit the model restated inside the phrase as a SECOND amount', () => {
        // ⚠️ `measurements: "2 cups"` + `units: "cups"` is the common consistent filling. Appending the
        // stated unit to the residue instead of replacing the derived one reports `amountCountDiffers` —
        // a disagreement about nothing, manufactured by the fold.
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: '2 cups',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        });

        const agreement = answer.ok
            ? compareParses(answer.parse, crf({ measure: '2 cups', names: ['flour'] }))
            : undefined;

        expect(agreement?.measure).toBe('agree');
    });

    it('keeps a genuine SECOND amount in the residue', () => {
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: '2 cups 3 tablespoons',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        });

        const agreement = answer.ok
            ? compareParses(answer.parse, crf({ measure: '2 cups', names: ['flour'] }))
            : undefined;

        expect(agreement?.measure).toBe('amountCountDiffers');
    });
});

describe('buildVariantPrompt', () => {
    it('sends the arm’s system prompt with the SHIPPED delimiter, byte for byte', () => {
        for (const id of PARSE_VARIANT_IDS) {
            const variant = resolveParseVariant(id);
            const prompt = buildVariantPrompt(variant, 'one cup of flour');

            expect(prompt.systemPrompt).toBe(variant.systemPrompt);

            // ⛔ ONE authority for the delimiter, for every arm that does not declare its own. A locally
            // re-spelled tag would make the arms incomparable while every other assertion still passed.
            //
            // ⛔ REWRITTEN for v6, which names `<input>` in the owner's own text. What an arm may vary is
            // the DELIMITER; what it may never vary is the CONTENT — so an arm with its own turn is held to
            // the stronger property instead: the line, whole, and nothing whatsoever beside it.
            if (variant.buildUserTurn === undefined) {
                expect(prompt.userMessage).toBe('<ingredient_line>one cup of flour</ingredient_line>');
            } else {
                // The scaffold is CONSTANT and the line is the only variable content in it: strip the line
                // and what remains must be exactly what the arm emits for an empty line. That catches an
                // arm that smuggled anything else — a hint, a label, a CRF reading — into its own turn.
                expect(prompt.userMessage).toContain('one cup of flour');
                expect(prompt.userMessage.replace('one cup of flour', '')).toBe(variant.buildUserTurn(''));
            }
        }
    });

    it('is byte-identical to the shipped assembly for the baseline arm', () => {
        expect(buildVariantPrompt(PARSE_VARIANT_V1, 'two eggs').systemPrompt).toBe(PARSE_VARIANT_V1.systemPrompt);
    });

    it('REJECTS an over-cap line against the arm’s own longer prompt, rather than truncating it', () => {
        // ⛔ ADR-0024: an over-cap line is refused, never trimmed — a truncated line asks the model to parse
        // text the source did not write. `buildParsePrompt` can only bound v1's length, so each arm re-checks.
        //
        // ⛔ The arm is DERIVED, never named. This assertion used to name `v3` because v3 was the longest
        // arm the day it was written; a longer arm added later would have left it re-testing a shorter one
        // under a name that still read correctly — the same staleness the integration tier was repaired for.
        // ⛔ REWRITTEN for v6, which carries its OWN larger cap. The derivation now ranges over the arms on
        // the DEFAULT cap — an arm that raised its ceiling is not evidence about the default one — and the
        // raised arm is then held to its own ceiling in the same assertion. Weakening this to "the longest
        // arm throws eventually" would have let a future arm raise its cap and quietly stop being checked.
        const onDefaultCap = PARSE_VARIANT_IDS.map(resolveParseVariant).filter(
            (arm) => arm.promptCharCap === undefined,
        );
        const longest = onDefaultCap.reduce((widest, arm) =>
            [...arm.systemPrompt].length > [...widest.systemPrompt].length ? arm : widest,
        );

        expect(onDefaultCap.length).toBeGreaterThan(0);

        // ⛔ The overflowing line is DERIVED from the cap, never a literal. It was `'x'.repeat(1_900)` against
        // a 2,000 cap; the shipped cap then rose to 22,000 and the literal silently stopped overflowing —
        // the assertion passed vacuously until the throw check caught it. Deriving it is the same discipline
        // the surrounding comment already applies to WHICH arm is tested.
        const overflow = MAX_PARSE_PROMPT_CHARS - [...longest.systemPrompt].length + 1;

        expect(overflow).toBeGreaterThan(0);
        expect(() => buildVariantPrompt(longest, 'x'.repeat(overflow))).toThrow(
            new RegExp(`over the ${MAX_PARSE_PROMPT_CHARS} limit`, 'u'),
        );

        // Every arm that raised its ceiling is still REFUSED past that ceiling, never truncated.
        for (const arm of PARSE_VARIANT_IDS.map(resolveParseVariant)) {
            const cap = arm.promptCharCap;

            if (cap === undefined) {
                continue;
            }

            expect(() => buildVariantPrompt(arm, 'x'.repeat(cap))).toThrow(/over the \d+ limit/);
        }
    });

    it('passes the line through verbatim, including characters a sanitiser would touch', () => {
        const line = 'one cup of "flour" & <sugar>';

        expect(buildVariantPrompt(PARSE_VARIANT_V2, line).userMessage).toContain(line);
    });
});

describe('the arm reaches the response classifier', () => {
    it('calls a v2 document VALID under v2 and wrongShape under the default reader', () => {
        const text = '{"measure":"one cup","equipment":"a bowl","foods":[{"name":"flour","prep":null}]}';

        expect(classifyParseResponse(text, 'end_turn', PARSE_VARIANT_V2.readAnswer).kind).toBe('valid');
        // ⛔ THE ARTEFACT THIS EXPERIMENT MUST NOT COMMIT. Measured against v1's schema, a perfectly good v2
        // answer is a contract failure, and v2 would report as a catastrophe that never happened.
        expect(classifyParseResponse(text, 'end_turn').kind).toBe('wrongShape');
    });

    it('still applies the arm-independent rules — truncation beats shape', () => {
        const text = '{"measurements":"","equipment":null,"prep":null,"units":null,"foods":[]}';

        expect(classifyParseResponse(text, 'max_tokens', PARSE_VARIANT_V3.readAnswer).kind).toBe('truncated');
        expect(classifyParseResponse(text, 'end_turn', PARSE_VARIANT_V3.readAnswer).kind).toBe('valid');
    });

    it('unwraps a fenced answer against the arm’s shape', () => {
        const text = '```json\n{"measurements":"2","equipment":null,"prep":null,"units":"cups","foods":["flour"]}\n```';
        const outcome = classifyParseResponse(text, 'end_turn', PARSE_VARIANT_V3.readAnswer);

        expect(outcome.kind).toBe('proseWrapper');
        expect(outcome.kind === 'proseWrapper' && outcome.parse?.statedUnit).toBe('cups');
    });
});

describe('v5 — v3 plus a quantity slot', () => {
    /**
     * The owner's hypothesis, one field further: v3 already TELLS the model it understands quantities, and
     * then gives it nowhere to put one. v5 adds the slot and changes nothing else, so whatever moves is the
     * slot.
     *
     * ⛔ The quantity is READ AND DROPPED, exactly as v2/v4 drop `equipment`. Projecting it would make v5 a
     * different PIPELINE as well as a different prompt, and the run could no longer attribute the movement.
     */
    it('carries v3’s role-framing paragraph byte for byte, so the arms differ only after it', () => {
        const framing = PARSE_VARIANT_V3.systemPrompt.split('\n\n')[0];

        expect(framing).toBeTruthy();
        expect(PARSE_VARIANT_V5.systemPrompt.startsWith(`${framing}\n\n`)).toBe(true);
    });

    it('declares a quantity slot that v3 does not', () => {
        expect(PARSE_VARIANT_V5.systemPrompt).toContain('"quantity":string|null');
        expect(PARSE_VARIANT_V3.systemPrompt).not.toContain('"quantity"');
    });

    it('names the quantity in the classification list, not only in the document', () => {
        // The owner asked for it in BOTH places — the framing of what the model understands AND the output.
        const prose = PARSE_VARIANT_V5.systemPrompt.split('\n').filter((l) => !l.startsWith('{"'));

        expect(prose.join(' ')).toContain('quantit');
    });

    it('accepts its own document; v3 refuses it and it refuses v3’s', () => {
        const v5Document = {
            measurements: 'two',
            quantity: '2',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        };
        const v3Document = { measurements: 'two', equipment: null, prep: null, units: 'cups', foods: ['flour'] };

        expect(PARSE_VARIANT_V5.readAnswer(v5Document).ok).toBe(true);
        expect(PARSE_VARIANT_V3.readAnswer(v5Document).ok).toBe(false);
        expect(PARSE_VARIANT_V5.readAnswer(v3Document).ok).toBe(false);
    });

    it('DISCARDS the quantity value, projecting exactly what v3 projects', () => {
        const shared = { measurements: 'two', equipment: 'a bowl', prep: 'chopped', units: 'cups' } as const;
        const v5 = PARSE_VARIANT_V5.readAnswer({ ...shared, quantity: '2', foods: ['onions', 'carrots'] });
        const v3 = PARSE_VARIANT_V3.readAnswer({ ...shared, foods: ['onions', 'carrots'] });

        expect(v5.ok && v3.ok && v5.parse).toEqual(v3.ok ? v3.parse : undefined);
        expect(v5.ok && v5.parse.foods).toEqual([
            { name: 'onions', prep: 'chopped' },
            { name: 'carrots', prep: 'chopped' },
        ]);
    });

    it('takes the model’s stated unit, like v3 and unlike the derived arms', () => {
        expect(PARSE_VARIANT_V5.unitSource).toBe('model-stated');

        const answer = PARSE_VARIANT_V5.readAnswer({
            measurements: 'a pinch',
            quantity: null,
            equipment: null,
            prep: null,
            units: null,
            foods: ['salt'],
        });

        // Stated ABSENCE stays an empty string — never `undefined`, which would re-derive from the phrase.
        expect(answer.ok && answer.parse.statedUnit).toBe('');
    });

    it('is registered, so the runner can name it', () => {
        expect(PARSE_VARIANT_IDS).toContain('v5');
        expect(resolveParseVariant('v5')).toBe(PARSE_VARIANT_V5);
    });
});

describe('v6 — the owner’s zero-shot relational prompt, verbatim', () => {
    /**
     * ⛔ The owner supplied this prompt as TEXT and asked for it verbatim. Three harness collisions were
     * resolved by giving the ARM an override, never by editing the owner's words:
     *
     *  1. Its system half is 3,656 chars against `MAX_PARSE_PROMPT_CHARS`'s 2,000, so the arm carries its own
     *     cap. The shipped constant is NOT raised — it bounds the SHIPPED prompt and this is a candidate.
     *  2. It delimits with `<input>`, not the shipped `<ingredient_line>`. The arm supplies its own user turn.
     *     ⛔ The no-poisoning guard is untouched: what goes in is the LINE and nothing else.
     *  3. Its declared document is far more verbose than any prior arm's, so 200 output tokens would truncate
     *     and the arm would be damned by an artefact rather than by its prompt.
     */
    it('carries the owner’s text byte for byte, up to the <input> template', () => {
        const supplied = readFileSync(OWNER_PROMPT_PATH, 'utf8');
        const systemHalf = supplied.slice(0, supplied.lastIndexOf('<input>'));

        expect(PARSE_VARIANT_V6.systemPrompt).toBe(systemHalf);
    });

    it('keeps the owner’s <input> delimiter and puts ONLY the line inside it', () => {
        const { systemPrompt, userMessage } = buildVariantPrompt(PARSE_VARIANT_V6, 'one-half pound of onion');

        expect(userMessage).toBe('<input>\none-half pound of onion\n</input>');
        expect(systemPrompt).not.toContain('[INSERT UNTRUSTED RECIPE TEXT HERE]');
    });

    it('does NOT raise the shipped cap to accommodate itself', () => {
        // The arm's own cap admits it; the shipped constant still refuses it. Raising the shipped bound to
        // fit a candidate would weaken the guard that protects production.
        // ⚠️ REWRITTEN 2026-08-27. This read "does NOT raise the SHIPPED cap to accommodate itself" and
        // asserted v6's cap EXCEEDED `MAX_PARSE_PROMPT_CHARS`. The shipped cap then rose 2,000 -> 22,000 with
        // the prompt swap, so v6's 8,000 is now BELOW it and the comparison inverted. The property under test
        // was never "bigger than shipped" — it was "the arm carries its OWN bound, and that bound is the one
        // enforced", which is what this now asserts and which survives the shipped cap moving either way.
        expect(PARSE_VARIANT_V6.promptCharCap).toBeDefined();
        expect(PARSE_VARIANT_V6.promptCharCap).not.toBe(MAX_PARSE_PROMPT_CHARS);
        expect([...PARSE_VARIANT_V6.systemPrompt].length).toBeLessThan(PARSE_VARIANT_V6.promptCharCap!);
        expect(() => buildVariantPrompt(PARSE_VARIANT_V6, 'x')).not.toThrow();
    });

    it('reads the relational array, flattening groups into the common vocabulary', () => {
        const answer = PARSE_VARIANT_V6.readAnswer([
            {
                food_items: ['apples', 'pears'],
                measurement: { quantity: '1', unit: 'cup', unit_type: 'VOLUME' },
                preparations: ['chopped'],
                equipment: null,
            },
        ]);

        expect(answer.ok && answer.parse.foods).toEqual([
            { name: 'apples', prep: 'chopped' },
            { name: 'pears', prep: 'chopped' },
        ]);
        expect(answer.ok && answer.parse.measure).toBe('1');
        expect(answer.ok && answer.parse.statedUnit).toBe('cup');
    });

    it('takes the amount VERBATIM and never joins it to a restated unit', () => {
        // ⛔ Measured on the smoke run: this arm answers the whole phrase in `quantity` AND restates the
        // unit in `unit`. Joining them produced `two tablespoons tablespoons` — a phrase nothing wrote.
        const answer = PARSE_VARIANT_V6.readAnswer([
            {
                food_items: ['oil'],
                measurement: { quantity: 'two tablespoons', unit: 'tablespoons', unit_type: 'VOLUME' },
                preparations: null,
                equipment: null,
            },
        ]);

        expect(answer.ok && answer.parse.measure).toBe('two tablespoons');
        expect(answer.ok && answer.parse.statedUnit).toBe('tablespoons');
    });

    it('keeps every group’s foods, and each group’s own preparation', () => {
        const answer = PARSE_VARIANT_V6.readAnswer([
            {
                food_items: ['sugar'],
                measurement: { quantity: '1', unit: 'cup', unit_type: 'VOLUME' },
                preparations: null,
                equipment: null,
            },
            { food_items: ['butter'], measurement: null, preparations: ['melted'], equipment: null },
        ]);

        expect(answer.ok && answer.parse.foods).toEqual([
            { name: 'sugar', prep: null },
            { name: 'butter', prep: 'melted' },
        ]);
    });

    it('records a stated ABSENCE of measurement as an empty string, never as “derive it yourself”', () => {
        const answer = PARSE_VARIANT_V6.readAnswer([
            { food_items: ['salt'], measurement: null, preparations: null, equipment: null },
        ]);

        expect(answer.ok && answer.parse.measure).toBe('');
        expect(answer.ok && answer.parse.statedUnit).toBe('');
    });

    it('accepts an EMPTY array — a line naming nothing is an answer, not a failure', () => {
        const answer = PARSE_VARIANT_V6.readAnswer([]);

        expect(answer.ok && answer.parse.foods).toEqual([]);
        expect(answer.ok && answer.parse.measure).toBe('');
    });

    it('refuses every earlier arm’s document, and they refuse its own', () => {
        const v6Document = [
            {
                food_items: ['flour'],
                measurement: { quantity: '2', unit: 'cups', unit_type: 'VOLUME' },
                preparations: null,
                equipment: null,
            },
        ];

        expect(PARSE_VARIANT_V6.readAnswer(v6Document).ok).toBe(true);
        expect(PARSE_VARIANT_V1.readAnswer(v6Document).ok).toBe(false);
        expect(PARSE_VARIANT_V3.readAnswer(v6Document).ok).toBe(false);
        expect(PARSE_VARIANT_V6.readAnswer({ measure: '', foods: [] }).ok).toBe(false);
    });

    it('raises its output budget, so a verbose document is not damned by truncation', () => {
        // ⚠️ Same inversion: the shipped budget rose 200 -> 900 with the relational document, so v6's 600 is
        // now below it. What matters is that the arm STATES its own budget rather than inheriting one.
        expect(PARSE_VARIANT_V6.maxOutputTokens).toBeDefined();
        expect(PARSE_VARIANT_V6.maxOutputTokens).not.toBe(PARSE_MAX_OUTPUT_TOKENS);
    });

    it('is registered, so the runner can name it', () => {
        expect(PARSE_VARIANT_IDS).toContain('v6');
        expect(resolveParseVariant('v6')).toBe(PARSE_VARIANT_V6);
    });
});
