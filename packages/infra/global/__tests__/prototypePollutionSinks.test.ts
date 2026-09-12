// @vitest-environment node
/**
 * Repo-wide guard: **an accumulator indexed by a DATA-DERIVED key has a null prototype.**
 *
 * ## Why this exists
 *
 * `out[key] = …` on an object literal walks the prototype chain. When `key` comes from the data — a parsed
 * log line, a Sentry event, a caller's attribute bag — an entry named `__proto__` reaches
 * `Object.prototype`'s inherited setter instead of defining a property. Two things follow, and the quiet one
 * is worse: the field is **silently dropped** from the output, and what it carried travels with the merge.
 *
 * ⛔ It was in FIVE places at once, which is why the answer is a guard and not five fixes. CodeQL found
 * three of them (all in one file); the other two — `identity-webhooks`' access-log sanitizer, which rebuilds
 * a line from parsed JSON, and `@commise/mobile`'s Sentry scrubber — it did not flag, and neither did any
 * review. They are the same function copied, so the defect was copied with it.
 *
 * ⚠️ SCOPE, stated rather than implied, and WIDER than it was. `productionSources()` reads `.ts` under
 * `packages/` and `shared/`; this guard adds `.tsx` and the repository's `.mjs` scripts on top, because
 * "outside the stated scope" was the reason one real sink went unfixed for a round — `scripts/
 * prepareProdManifest.mjs` rebuilt a `package.json` `exports` map onto a literal, so a subpath named
 * `__proto__` was dropped from every deployable service's SHIPPED manifest, surfacing only as an import
 * failing at runtime inside the built image. A scope note is a description, never an excuse.
 *
 * ⚠️ The sweep is this guard's OWN, not a change to `productionSources()`: ten other guards read that
 * helper, and "production TypeScript" is not this file's meaning to widen on their behalf.
 *
 * ⚠️ The remedy is never wrong. A null-prototype bag is a strictly better accumulator for string-keyed data
 * whatever the keys turn out to be, so a finding here is never a false positive in the costly direction —
 * at worst it asks for a change that was already correct.
 */
import { describe, expect, it } from 'vitest';

import { readSource, sinkScanSources, withoutTsComments } from './roleSplitSources.js';

let scannedCache: readonly string[] | undefined;
const rawCache = new Map<string, string>();
const strippedCache = new Map<string, string>();

/**
 * The space-free core of an INDEXED write (`out[key]`), as a pattern fragment.
 *
 * ⚠️ Space-free BY CONSTRUCTION — every character class here excludes whitespace — and that is the only
 * property {@link DATA_KEY_WRITE} may rely on. A `\s` or a negated class dropped in here would re-arm the
 * trap described on that constant, so the property is asserted rather than left to the reader.
 */
const INDEXED_WRITE = String.raw`\[[A-Za-z_$][\w$]*\]`;

/** The space-free core of a merge write (`Object.assign(out, …)`), as a pattern fragment. */
const ASSIGN_WRITE = String.raw`Object\.assign\(`;

/**
 * The cheap raw-text pre-filter, and it screens the WRITE rather than the DECLARATION.
 *
 * ⛔ THIS IS WHERE A TRAP USED TO BE, and moving the filter here is what disarms it rather than re-pinning
 * it. The filter used to screen for the token `{}` that `LITERAL_ACCUMULATOR` happened to require, so the
 * two encoded ONE fact in TWO places: widening the pattern to admit a non-empty initialiser — exactly the
 * widening this file just took — would have left the filter screening for something no match need contain,
 * and the sweep would have started passing by finding NOTHING while looking perfectly green.
 *
 * ⚠️ The soundness condition was never "every match of `LITERAL_ACCUMULATOR` contains the token"; it is
 * "a SKIPPED file contains no FINDING", and a finding is a declaration match AND {@link takesDataKeys}.
 * Screening the write side satisfies that from the OTHER conjunct — so it holds whatever the declaration
 * pattern grows to admit, and no future widening can break it again. The hazard class is deleted, not
 * re-pinned.
 *
 * ⚠️ It is built FROM the fragments `takesDataKeys` builds its own patterns from, so the two cannot drift:
 * there is one declaration of each, not a copy. What is still asserted below is the property composition
 * cannot enforce — that each fragment matches only space-free text, which is what licenses reading the RAW
 * file. `withoutTsComments` preserves length and substitutes only spaces, so a space-free match in the
 * stripped text sits at the same offset in the raw text; a file whose raw text cannot match cannot gain a
 * match by being stripped.
 *
 * ⚠️ And it costs nothing: 491 of the 1,983 swept files match it against 523 for the old `{}` token, so the
 * strip — the expensive per-character pass — is still paid on roughly a quarter of the corpus.
 */
const DATA_KEY_WRITE = new RegExp(`${INDEXED_WRITE}|${ASSIGN_WRITE}`, 'u');

/**
 * The call the vacuity check looks for, to prove the discovery still finds sources.
 *
 * ⚠️ Space-free for the same reason as {@link DATA_KEY_WRITE}'s fragments: it is screened for twice, once
 * raw and once stripped, and only a space-free token may be screened for raw.
 */
const WALK_TOKEN = 'Object.entries(';

/**
 * One source's raw text, read once per file for the whole file.
 *
 * @param path - A repo-relative source path.
 * @returns The file's text.
 * @sideEffect Reads the file from disk and memoises it.
 */
function rawSource(path: string): string {
    let text = rawCache.get(path);

    if (text === undefined) {
        text = readSource(path);
        rawCache.set(path, text);
    }

    return text;
}

/**
 * One source's text with comments blanked, computed once per file for the whole file.
 *
 * ⛔ CACHED, and that is a CI requirement rather than a tuning choice. Widening the sweep to `.tsx` and
 * `.mjs` added 693 files, and the two assertions below walk the set independently — so every file was read
 * and scanned twice, `withoutTsComments` being a per-character scanner. It TIMED OUT on CI's 2-core runner
 * and failed `infra — global` in both lanes on the first push. A guard that cannot finish is a guard that
 * is switched off.
 *
 * ⚠️ The limit it hit is the 30s set DELIBERATELY in this package's `vitest.config.ts` — vitest's own
 * default is 5s — whose rationale anticipates this exact class: "intermittently exceeds the default under
 * the parallel turbo test load on CI runners". Raising it again was available and is the wrong lever; the
 * file now measures ~6.2s against that 30s under a two-core pin, and the headroom is the point.
 *
 * @param path - A repo-relative source path.
 * @returns The comment-blanked text.
 * @sideEffect Reads the file through {@link rawSource} and memoises the result.
 */
function strippedSource(path: string): string {
    let text = strippedCache.get(path);

    if (text === undefined) {
        text = withoutTsComments(rawSource(path));
        strippedCache.set(path, text);
    }

    return text;
}

/**
 * Every file this guard reads, memoised for the run.
 *
 * ⚠️ The discovery itself is `sinkScanSources()` in `roleSplitSources.ts`, shared with the lemma in
 * `withoutTsComments.test.ts` that licenses the raw-text pre-filter below — declared twice, they drifted,
 * and the lemma ended up covering 64% of what this sweeps.
 *
 * @returns Sorted repo-relative paths.
 * @sideEffect Shells out to `git ls-files`, once per run.
 */
function scannedSources(): readonly string[] {
    scannedCache ??= sinkScanSources();

    return scannedCache;
}

/**
 * `const name: <string-keyed map> = { … };` — an accumulator declared as an object literal, empty or not.
 *
 * ⛔ IT ENUMERATES NOTHING ABOUT THE TYPE, and that is the third attempt. Version one required the literal
 * text `Record<string, unknown>` and missed `schemas`/`paths` in `contract-gen/src/openapi.ts` — siblings
 * of the accumulator it HAD just found, one and eighty lines away in the same file, whose annotation is a
 * nested `Record`. Version two added `Attributes` and `Partial<Record<…>>` by name and still missed
 * `local-sandbox/bin/up.ts`, where a `;` inside an inline object type ends the character class. Each fix
 * enumerated one more spelling, which is the failure `RecipeWorkersStack`'s asset guard states in almost
 * these words: a copy of a list cannot detect that the list is incomplete.
 *
 * So the declaration is matched by SHAPE — any `const`/`let` initialised to an object literal, annotated or
 * not — and `takesDataKeys` alone decides. That widens the finding set, which by the remedy's own
 * never-wrong property is the cheap direction.
 *
 * ⛔ AND IT ENUMERATES NOTHING ABOUT THE INITIALISER EITHER, which is version four. Versions one to three
 * all required a BARE `{}`, a claim about what the bag STARTED with — and a sink does not care: `food-
 * service`'s `buildEmf` seeded `const payload: Record<string, unknown> = { _aws: … }` and then wrote every
 * dimension and metric NAME into it, so this pattern matched NOTHING AT ALL in that file. The match now
 * ends at the opening `{` (a regex cannot balance braces, and does not need to — the name and "it is an
 * object literal" are the whole finding), which also retires the `{} as T` tail as a special case.
 */
const LITERAL_ACCUMULATOR = /(?:const|let) (\w+)(?:\s*:[^=]+)? = \{/gu;

/**
 * One literal, escaped for embedding in a pattern.
 *
 * ⚠️ EXTRACTED because this file once carried a SECOND, weaker escaper — a per-character `\\${c}`, correct
 * only for a token of punctuation and nonsense the moment the literal contains a letter. That copy went with
 * the raw-text token it escaped; two spellings of one rule in one file is the shape this guard's own subject
 * matter warns about, so the survivor is the one every caller uses.
 *
 * @param literal - The text to match verbatim.
 * @returns The literal with every regex metacharacter escaped. Pure.
 */
function escapeForRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * Whether `name`'s keys can come from data.
 *
 * ⚠️ `Object.assign` counts, and missing it cost a site. It performs `[[Set]]`, exactly like `out[key] =`,
 * so merging a caller-supplied object into a literal has the identical sink — that is
 * `NestRoutedLogger.ts`, which contains no `Object.entries` at all and was skipped entirely by the file
 * gate this replaced.
 *
 * ⛔ `Object.fromEntries` and spread (`{ ...acc, [key]: value }`) are deliberately NOT here: both use
 * `CreateDataProperty`, which defines an own property and never reaches a setter. They are the safe
 * spellings, so treating them as findings would teach the opposite of the lesson.
 *
 * @param text - The comment-stripped source.
 * @param name - The accumulator's identifier.
 * @returns Whether a data-derived key reaches it. Pure.
 */
function takesDataKeys(text: string, name: string): boolean {
    const escaped = escapeForRegExp(name);

    return (
        new RegExp(String.raw`\b${escaped}${INDEXED_WRITE}\s*=`, 'u').test(text) ||
        new RegExp(String.raw`${ASSIGN_WRITE}\s*${escaped}\s*,`, 'u').test(text)
    );
}

/**
 * Every literal accumulator that is later indexed by a variable, in a file that iterates data keys.
 *
 * ⚠️ Read through `withoutTsComments`, so an example inside a docstring — including the ones in this
 * guard's own siblings — is not a finding.
 *
 * @returns Sorted `path: name` ids. Pure.
 */
function findLiteralAccumulators(): readonly string[] {
    const offenders: string[] = [];

    for (const path of scannedSources()) {
        // ⛔ A CHEAP PRE-FILTER, AND IT CANNOT CHANGE THE ANSWER — on a property of the STRIPPER that is
        // ASSERTED rather than argued here. `withoutTsComments` preserves length and only ever substitutes
        // spaces, so it cannot manufacture a match that contains NO SPACE; `withoutTsComments.test.ts`
        // pins that over every file the guards read. `DATA_KEY_WRITE` matches only space-free text, so a
        // file whose raw text cannot match it cannot gain a match by being stripped — and three quarters
        // of the corpus is skipped before the strip.
        //
        // ⛔ THE SPACE-FREE QUALIFIER IS LOAD-BEARING, and a token like ` = {}` is exactly what it rules
        // out: `const out: Record<string, unknown>` followed by an inline comment and then `= {};` has no
        // ` = {}` raw, gains one when the comment blanks, and IS a sink — so screening the raw text for it
        // would skip a real finding. That case is pinned beside the lemma. Two earlier versions of this
        // note got the reasoning wrong in opposite directions; it is code now, in one place, rather than
        // prose in two.
        //
        // ⚠️ It screens the WRITE, not the declaration, so it is immune to every future widening of
        // `LITERAL_ACCUMULATOR` — see `DATA_KEY_WRITE`, where the trap that cost this reasoning is stated.
        if (!DATA_KEY_WRITE.test(rawSource(path))) {
            continue;
        }

        const text = strippedSource(path);

        for (const match of text.matchAll(LITERAL_ACCUMULATOR)) {
            const name = match[1] ?? '';

            // Written through a VARIABLE (`out[key] =`) or merged into (`Object.assign(out, …)`), not
            // indexed by a literal (`out['total']`) — the first two are the data-derived shape, the third
            // is an ordinary record build.
            if (takesDataKeys(text, name)) {
                offenders.push(`${path}: ${name}`);
            }
        }
    }

    return offenders.sort();
}

/**
 * Every shape of the sink, as `[declaration, write]` — the positive table.
 *
 * ⚠️ AT MODULE SCOPE because TWO tests read it: the one that proves the detector still detects, and the one
 * that proves {@link DATA_KEY_WRITE} admits every write that detector counts. A second copy of the writes
 * would be a table that agrees with itself while the pre-filter and `takesDataKeys` diverge.
 *
 * ⚠️ INLINE STRINGS, never fixture FILES: `sinkScanSources()` sweeps the working tree, so a `.ts` fixture of
 * a deliberate sink would be swept as a real source and fail the gate it exists to exercise.
 */
const SINK_CASES: readonly (readonly [string, string])[] = [
    ['const out: Record<string, unknown> = {};', 'out[key] = 1;'],
    ['const out: Record<string, Record<string, unknown>> = {};', 'out[key] = {};'],
    ['let out: Record<string, string> = {};', 'out[key] = value;'],
    ['const out: Attributes = {};', 'out[key] = value;'],
    ['const out: Record<string, unknown> = {};', 'Object.assign(out, param);'],
    // ⛔ The three that got past version two, each a different way of spelling the same sink.
    ['const out: Record<string, { hostPort: number; containerPort: number }> = {};', 'out[key] = v;'],
    ['const out: RecipeFormErrors = {};', 'out[field] = code;'],
    ['const out = {} as Record<K, number>;', 'out[field] = 1;'],
    // ⛔ The one version three missed, and it is a SHAPE hole rather than one more spelling of the
    // annotation: an accumulator SEEDED with content. `food-service`'s `buildEmf` declared
    // `const payload: Record<string, unknown> = { _aws: … }` and then wrote every dimension and metric
    // NAME into it — a live sink in which the pattern matched nothing whatsoever, because requiring a bare
    // `{}` is a claim about the initialiser's CONTENTS and a sink does not care what the bag started with.
    ['const payload: Record<string, unknown> = {\n    _aws: { Timestamp: 0 },\n};', 'payload[key] = value;'],
];

describe('accumulators indexed by data-derived keys', () => {
    /**
     * ⛔ ITS OWN TIMEOUT, BECAUSE THE PACKAGE CEILING IS FOR SOMETHING ELSE. `vitest.config.ts`'s 30 s is
     * sized for CDK stack synthesis; this test pays a different cost, and the two should not be tied
     * together. Measured: the sweep strips **491 files** through `withoutTsComments` in **5.65 s** locally —
     * reading the corpus is 36 ms and the pre-filter 7 ms, so the stripper IS the run — and on a loaded CI
     * runner the same work took **44.3 s**, overran the 30 s ceiling and failed the `infra — global` job.
     *
     * ⚠️ Only the FIRST sweep-backed test pays it; `strippedCache` serves every later one. Two cheaper
     * explanations were measured and REJECTED rather than assumed: `LITERAL_ACCUMULATOR`'s backtracking
     * (17 ms over 2,000 files) and the per-declaration `RegExp` construction that widening multiplied 34x
     * (memoising by name returned 10%). Neither is the cost; the stripper is, and it is doing correct work.
     */
    const SWEEP_TIMEOUT_MS = 120_000;

    it(
        '⛔ never use an object literal, which exposes the inherited `__proto__` setter',
        () => {
            expect(
                findLiteralAccumulators(),
                'declare this as `Object.create(null)`: an entry named `__proto__` is otherwise dropped ' +
                    'silently rather than stored',
            ).toEqual([]);
        },
        SWEEP_TIMEOUT_MS,
    );

    it('is not vacuous — it reads the files that build records from data keys', () => {
        // ⛔ Without this, a discovery that stopped finding sources would make the gate above pass by
        // finding nothing, which is the failure every derived-set guard here is most exposed to.
        // Same invariant as the sweep above — blanking cannot CREATE a token — so the raw check is a pure
        // short-circuit and the strip is paid only where it can matter.
        const scanned = scannedSources().filter(
            (path) => rawSource(path).includes(WALK_TOKEN) && strippedSource(path).includes(WALK_TOKEN),
        );

        expect(scanned.length).toBeGreaterThanOrEqual(10);

        // ⛔ AND THE PRE-FILTER ITSELF SELECTS A REAL CORPUS, which is the property the OLD design got
        // for free and this one does not. Screening for a token the pattern had to contain made an empty
        // filter a contradiction in the source; screening the WRITE side is pinned to `SINK_CASES` instead,
        // and those are synthetic strings a broken filter can still match. So the floor is stated over the
        // TREE: a filter that quietly stopped selecting files would skip every source, and the gate above
        // would pass by finding nothing — measured at 491 of 1,983 when this was written, so 100 is a floor
        // with room rather than a figure that rots on the next commit.
        expect(
            scannedSources().filter((path) => DATA_KEY_WRITE.test(rawSource(path))).length,
            'the pre-filter selects almost no files — the sweep would pass by finding nothing',
        ).toBeGreaterThanOrEqual(100);

        // ⛔ And each widened extension is really reached, so the sweep cannot quietly narrow back to `.ts`
        // and keep passing on the strength of the TypeScript it still reads.
        for (const extension of ['.tsx', '.mjs']) {
            expect(
                scannedSources().filter((path) => path.endsWith(extension)).length,
                `the sweep reads no ${extension} files — its scope has narrowed`,
            ).toBeGreaterThan(0);
        }
    });

    /**
     * ⛔ A GUARD THAT HAS NEVER FAILED IS NOT A GUARD. The real tree is clean, so the only way to know the
     * detector still detects is to hand it each shape directly — including the two it MISSED when it was
     * first written (a nested `Record` annotation, and `Object.assign` in a file with no `Object.entries`).
     */
    it('⛔ recognises every shape of the sink, including the two that got past its first version', () => {
        for (const [declaration, write] of SINK_CASES) {
            const source = `${declaration}\n${write}`;
            const name = /(?:const|let) (\w+)/u.exec(declaration)?.[1] ?? '';

            expect([...source.matchAll(LITERAL_ACCUMULATOR)].length, declaration).toBe(1);
            expect(takesDataKeys(source, name), write).toBe(true);
        }
    });

    /**
     * ⛔ THE TWO PROPERTIES THE PRE-FILTER RESTS ON, asserted where they can actually be broken. The sweep
     * skips a file whose RAW text cannot match {@link DATA_KEY_WRITE} before paying for the comment strip,
     * and that is sound only while (a) the filter matches nothing but SPACE-FREE text — otherwise a spaced
     * match in the stripped text need not exist raw, and a real finding is skipped — and (b) the filter
     * admits every write {@link takesDataKeys} counts, or the sweep starts passing by finding nothing.
     *
     * ⚠️ (b) IS NOT A FIXTURE TABLE AGREEING WITH ITSELF. The writes are the SAME rows the detector test
     * consumes, so tightening the filter past what the detector accepts goes red here — measured by
     * replacing `DATA_KEY_WRITE` with `Object\.assign\(` alone, which fails this assertion on `out[key] = 1;`
     * while every other test in the file stays green.
     */
    it('⛔ the pre-filter matches only space-free text, and admits every write the detector counts', () => {
        for (const fragment of [INDEXED_WRITE, ASSIGN_WRITE]) {
            // A literal space, a whitespace class, or a NEGATED class (which matches spaces by omission) —
            // any of the three makes a match that the stripper could have manufactured out of a comment.
            expect(/ |\\s|\[\^/u.test(fragment), `${fragment} can match a space`).toBe(false);
            expect(DATA_KEY_WRITE.source, 'the filter is built from this fragment').toContain(fragment);
        }

        for (const [, write] of SINK_CASES) {
            expect(DATA_KEY_WRITE.test(write), `the pre-filter would skip a file containing \`${write}\``).toBe(true);
        }
    });

    it('⛔ does NOT flag the safe spellings, which define own properties rather than setting', () => {
        const safe = [
            'const out = Object.fromEntries(entries);',
            'const out = entries.reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});',
            "const out: Record<string, unknown> = {}; out['total'] = 1;",
        ];

        for (const source of safe) {
            const name = /(?:const|let) (\w+)/u.exec(source)?.[1] ?? 'out';
            const declared = [...source.matchAll(LITERAL_ACCUMULATOR)].length > 0;

            expect(declared && takesDataKeys(source, name), source).toBe(false);
        }
    });
});
