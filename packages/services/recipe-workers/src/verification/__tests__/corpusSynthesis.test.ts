/**
 * THE SYNTHETIC BAKE-OFF CORPUS (plan U11 / KTD-4, owner ruling 2026-08-23).
 *
 * ⛔⛔ WHAT THIS CORPUS IS, ASSERTED HERE SO IT CANNOT BE MISREAD LATER. U11 assumed a hand-annotated slice of
 * 2,432 lines from public-domain cookbooks. ADR-0023 forbids anything in this repository from fetching that
 * material, and no operator has supplied the file — so the owner ruled that a corpus we can GENERATE is
 * substituted, and that its results are labelled NOT COMPARABLE to U1's annotation protocol.
 *
 * That substitution is only admissible because of one property, which every test below exists to protect:
 * **ground truth is known BY CONSTRUCTION.** We build the (line, candidate) pair, so whether the pair matches
 * is a fact about how it was built, not a judgement an annotator made. The moment a class stops being
 * constructively true — a "near miss" that is actually the same food, a "correct" line whose phrasing no
 * longer names its row — the corpus is measuring the generator instead of the model.
 *
 * ⚠️ What it therefore CANNOT tell you: field accuracy. These are constructed contrasts, and the mix of
 * contrasts is chosen, not observed. It measures DISCRIMINATION between a right and a plausibly-wrong
 * candidate. That is the thing the gate does, and it is not the same thing as "how often is the cascade right
 * in the wild".
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { makeCatalogRows } from '../__fixtures__/catalog.js';
import { isEmptyCatalogError, synthesizeBakeOffCorpus, usableCatalogRows } from '../corpusSynthesis.js';
import { usdaSegments } from '../cookPhrasing.js';

const rows = makeCatalogRows();

const synthesize = (overrides: { seed?: number; targetSize?: number } = {}) =>
    synthesizeBakeOffCorpus({ rows, seed: overrides.seed ?? 20260823, targetSize: overrides.targetSize ?? 24 });

const linesOfClass = (result: ReturnType<typeof synthesize>, contrastClass: string) =>
    result.lines.filter((line) => line.contrastClass === contrastClass);

describe('synthesizeBakeOffCorpus — determinism', () => {
    it('produces byte-identical output for the same seed and the same catalog', () => {
        const first = synthesize();
        const second = synthesize();

        expect(JSON.stringify(second.lines)).toBe(JSON.stringify(first.lines));
        expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(first.manifest));
    });

    /**
     * ⛔ PINS THE SEQUENCE ITSELF, not merely that two runs agree.
     *
     * The two assertions around this compare a corpus against ANOTHER RUN IN THE SAME PROCESS, so they hold
     * for any generator that is internally consistent — including one whose random stream has completely
     * changed. That is not hypothetical: the `pure-rand` 7 -> 8 upgrade replaced
     * `unsafeUniformIntDistribution` with `uniformInt`, and had the stream shifted, every one of those
     * assertions would still have passed while every previously-generated corpus silently stopped being
     * reproducible under the same seed and the same `CORPUS_GENERATOR_VERSION`.
     *
     * ⚠️ A DIGEST, not the corpus text. The point is to fail loudly when the stream moves; carrying 24
     * synthesised lines inline would make an intentional generator change a large unreadable diff, and the
     * failure message already names the cause. When this fails deliberately, bump
     * `CORPUS_GENERATOR_VERSION` in the same commit — a changed stream under an unchanged version is what
     * makes two corpora incomparable.
     */
    it('pins the RNG stream, so a generator or dependency change cannot move it silently', () => {
        const digest = createHash('sha256').update(JSON.stringify(synthesize().lines)).digest('hex');

        expect(digest).toBe('361fa544ba3be4730f3436e8bc0085446828fb74b24ce15ef885182d7475a6e4');
    });

    it('produces DIFFERENT output for a different seed, so the seed is really the source of choice', () => {
        // ⛔ Compared with the lineId REMOVED. The id embeds the seed, so comparing whole lines would differ
        // even for a generator that ignored the seed for every real decision — which is precisely the mutant
        // this test exists to kill, and precisely the one it failed to kill in its first draft.
        const bodies = (seed: number) =>
            JSON.stringify(synthesize({ seed }).lines.map(({ lineId: _id, ...rest }) => rest));

        expect(bodies(1)).not.toBe(bodies(2));
    });

    it('never reaches for Math.random', () => {
        // The mutation lens, mechanised: if any decision fell through to the global PRNG this throws, and the
        // determinism assertions above would then be true only by luck of a fixed call order.
        const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('Math.random is banned in a corpus that must reproduce byte-for-byte');
        });

        try {
            expect(() => synthesize()).not.toThrow();
        } finally {
            spy.mockRestore();
        }
    });

    it('records the catalog it came from, so a corpus cannot be attributed to the wrong catalog', () => {
        const base = synthesize();
        const shifted = synthesizeBakeOffCorpus({
            rows: [...rows, { id: 'f99', name: 'Barley, pearled, raw' }],
            seed: 20260823,
            targetSize: 24,
        });

        expect(base.manifest.catalogDigest).not.toBe(shifted.manifest.catalogDigest);
        expect(base.manifest.catalogRowCount).toBe(rows.length);
    });
});

describe('synthesizeBakeOffCorpus — provenance', () => {
    it('marks itself synthetic and not comparable to the annotation protocol, in the manifest', () => {
        const { manifest } = synthesize();

        expect(manifest.synthetic).toBe(true);
        expect(manifest.groundTruth).toBe('by-construction');
        expect(manifest.notComparableTo).toMatch(/annotation/iu);
        expect(manifest.seed).toBe(20260823);
    });

    it('prefixes every lineId with "synthetic-", so a trial record carries the warning too', () => {
        // The manifest is a sidecar and sidecars get separated from their file. The id cannot be.
        for (const line of synthesize().lines) {
            expect(line.lineId.startsWith('synthetic-')).toBe(true);
        }
    });

    it('issues unique line ids — the scorer pairs swap variants by id, and a collision would fuse two lines', () => {
        const ids = synthesize().lines.map((line) => line.lineId);

        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('synthesizeBakeOffCorpus — class balance', () => {
    it('splits the target evenly across the four classes when every pool can supply it', () => {
        const { manifest, lines } = synthesize({ targetSize: 24 });

        expect(manifest.classBalance).toEqual({
            correct: 6,
            nearMissIdentity: 6,
            wrongFormIdentity: 6,
            quantityUnitError: 6,
        });
        expect(lines).toHaveLength(24);
    });

    it('RECORDS a shortfall rather than padding a class it cannot fill', () => {
        // ⛔ The wrong-form class is the scarce one on the real catalog too (311 rows of 8,094). Padding it —
        // by reusing a pair with a different quantity — would inflate the sample without adding information,
        // and the report would then quote a denominator that is not really 608 independent contrasts.
        const { manifest } = synthesize({ targetSize: 40 });

        expect(manifest.classBalance.wrongFormIdentity).toBeLessThan(10);
        expect(manifest.classShortfalls.wrongFormIdentity).toBeGreaterThan(0);
        expect(manifest.classShortfalls.correct).toBe(0);
    });

    it('allocates the SCARCEST class first, so a plentiful class cannot starve it', () => {
        // Every class draws from the same invertible pool. Taking the near misses first would consume the
        // handful of rows that also have a form counterpart, and the wrong-form class would collapse for a
        // reason that has nothing to do with the catalog.
        // ⛔ ASSERTED BEHAVIOURALLY, not by reading the constant back. Four of the fixture's eight
        // form-capable rows ALSO have a head-sharing sibling, so taking the near misses first consumes them
        // and the wrong-form class comes up short. Exhausting the form pool exactly, on every seed, is only
        // possible if it claimed first.
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
            const { manifest } = synthesize({ seed, targetSize: 32 });

            expect(manifest.classBalance.wrongFormIdentity).toBe(8);
            expect(manifest.classShortfalls.wrongFormIdentity).toBe(0);
        }

        expect(synthesize().manifest.allocationOrder[0]).toBe('wrongFormIdentity');
    });

    it('INTERLEAVES the classes, so `--limit 20` smoke-tests a mixture rather than one class', () => {
        // ⛔ Emitted in class order, the runner's `--limit` would take 20 wrong-form lines, every one of them
        // `parseIsCorrect: false` — and `falseDisagreeRate` would come back 0 over an empty denominator,
        // which reads as a perfect model.
        const firstSix = synthesize({ targetSize: 24 }).lines.slice(0, 6);

        expect(new Set(firstSix.map((line) => line.contrastClass)).size).toBeGreaterThan(1);
        expect(new Set(firstSix.map((line) => line.parseIsCorrect)).size).toBe(2);
    });

    it('refuses a catalog with nothing invertible in it, rather than emitting an empty corpus', () => {
        try {
            synthesizeBakeOffCorpus({
                rows: [{ id: 'x1', name: 'Babyfood, GERBER, GRADUATES Lil Biscuits Vanilla Wheat' }],
                seed: 1,
                targetSize: 8,
            });
            expect.unreachable('an unusable catalog must not yield a corpus');
        } catch (error) {
            expect(isEmptyCatalogError(error)).toBe(true);
        }
    });
});

describe('synthesizeBakeOffCorpus — ground truth by construction', () => {
    it('never invents a candidate: every candidate name is a real catalog row', () => {
        const names = new Set(rows.map((row) => row.name));

        for (const line of synthesize().lines) {
            expect(names.has(line.candidateFoodName)).toBe(true);
        }
    });

    it('class 1 (correct) offers the very row the phrasing came from', () => {
        const correct = linesOfClass(synthesize(), 'correct');

        expect(correct.length).toBeGreaterThan(0);

        for (const line of correct) {
            expect(line.parseIsCorrect).toBe(true);
        }
    });

    it('class 2 (near-miss identity) offers a DIFFERENT row that shares the head term', () => {
        const result = synthesize();
        const nearMiss = linesOfClass(result, 'nearMissIdentity');
        const correct = linesOfClass(result, 'correct');

        expect(nearMiss.length).toBeGreaterThan(0);

        for (const line of nearMiss) {
            const twin = correct.find((other) => other.sourceLine === line.sourceLine);

            expect(twin).toBeDefined();
            expect(line.parseIsCorrect).toBe(false);
            // The plausible-wrong-food the gate exists to catch: same head noun, different food.
            expect(line.candidateFoodName).not.toBe(twin?.candidateFoodName);
            expect(usdaSegments(line.candidateFoodName)[0]?.toLowerCase()).toBe(
                usdaSegments(twin?.candidateFoodName ?? '')[0]?.toLowerCase(),
            );
            expect(usdaSegments(line.candidateFoodName)[1]?.toLowerCase()).not.toBe(
                usdaSegments(twin?.candidateFoodName ?? '')[1]?.toLowerCase(),
            );
        }
    });

    it('pairs every near miss with its matching correct line — the residual slice IS that contrast', () => {
        const result = synthesize();
        const correct = linesOfClass(result, 'correct').map((line) => line.sourceLine);
        const nearMiss = linesOfClass(result, 'nearMissIdentity').map((line) => line.sourceLine);

        // Same phrasing, same quantity, only the candidate differs — so a rate measured over the two
        // isolates identity discrimination instead of confounding it with phrasing difficulty.
        expect([...nearMiss].sort()).toEqual([...correct].sort());
    });

    it('class 2 keeps the QUANTITY correct, so the identity contrast is not confounded', () => {
        const result = synthesize();

        for (const line of linesOfClass(result, 'nearMissIdentity')) {
            const twin = linesOfClass(result, 'correct').find((other) => other.sourceLine === line.sourceLine);

            expect(line.quantityLow).toBe(twin?.quantityLow);
            expect(line.quantityHigh).toBe(twin?.quantityHigh);
            expect(line.unit).toBe(twin?.unit);
        }
    });

    it('class 3 (wrong form) keeps the substance and changes a state that changes nutrition', () => {
        const byName = new Map(rows.map((row) => [row.name, row]));
        const result = synthesize();
        const wrongForm = linesOfClass(result, 'wrongFormIdentity');

        expect(wrongForm.length).toBeGreaterThan(0);

        for (const line of wrongForm) {
            expect(line.parseIsCorrect).toBe(false);
            expect(byName.has(line.candidateFoodName)).toBe(true);
            // raw vs cooked, dried vs raw, with salt vs without: the head and the substance segment survive.
            expect(usdaSegments(line.candidateFoodName)[0]).toBe(usdaSegments(line.sourceRowName ?? '')[0]);
            expect(line.candidateFoodName).not.toBe(line.sourceRowName);
        }
    });

    it('class 4 (quantity or unit error) keeps the FOOD right and contradicts the amount', () => {
        const result = synthesize();
        const corrupted = linesOfClass(result, 'quantityUnitError');

        expect(corrupted.length).toBeGreaterThan(0);

        for (const line of corrupted) {
            expect(line.parseIsCorrect).toBe(false);
            // Identity is correct — the candidate IS the row the line was phrased from.
            expect(line.candidateFoodName).toBe(line.sourceRowName);
            // …and the parse disagrees with what the line says, in one of the two ways a parser gets it wrong.
            expect(line.sourceLine).not.toContain(`${String(line.quantityLow)} ${String(line.unit)}`);
        }
    });
});

describe('synthesizeBakeOffCorpus — the lines a cook would recognise', () => {
    it('states the parsed quantity and unit in the line itself, for every line whose parse is correct', () => {
        for (const line of linesOfClass(synthesize(), 'correct')) {
            expect(line.quantityLow).not.toBeNull();
            const amount = String(line.quantityLow).replace('0.5', '1/2').replace('0.25', '1/4').replace('0.75', '3/4');

            expect(line.sourceLine.startsWith(amount)).toBe(true);

            if (line.unit !== null) {
                expect(line.sourceLine).toContain(line.unit);
            }
        }
    });

    it('emits a SINGULAR unit in the parse while the line reads naturally — the shape a real parser produces', () => {
        // A parser emits `cup`; the line says "2 cups". Emitting the plural in the parse would make every
        // multi-unit line a spurious quantity mismatch and inflate the false-disagree rate for a reason that
        // has nothing to do with the model.
        const units = synthesize({ targetSize: 24 })
            .lines.filter((line) => (line.quantityLow ?? 0) > 1)
            .map((line) => line.unit)
            .filter((unit): unit is string => unit !== null);

        expect(units.length).toBeGreaterThan(0);

        for (const unit of units) {
            expect(unit.endsWith('s')).toBe(false);
        }
    });

    it('writes a fractional amount with a SINGULAR unit, as a cook does', () => {
        // "1/2 teaspoons" is not English, and a line that reads wrong is a line the model judges for the
        // wrong reason.
        const halves = synthesize({ targetSize: 24 }).lines.filter(
            (line) => line.quantityLow !== null && line.quantityLow < 1 && line.unit !== null,
        );

        expect(halves.length).toBeGreaterThan(0);

        for (const line of halves) {
            if (line.contrastClass !== 'quantityUnitError') {
                expect(line.sourceLine).toContain(` ${String(line.unit)} `);
            }
        }
    });

    it('names the food it was phrased from, so a reader can audit any line against the catalog', () => {
        for (const line of synthesize().lines) {
            expect(rows.some((row) => row.name === line.sourceRowName)).toBe(true);
        }
    });
});

describe('usableCatalogRows', () => {
    it('reports how much of a catalog the generator can actually phrase from', () => {
        expect(usableCatalogRows(rows)).toHaveLength(rows.length);
        expect(usableCatalogRows([...rows, { id: 'z1', name: 'Snacks, potato chips, plain' }])).toHaveLength(
            rows.length,
        );
    });
});
