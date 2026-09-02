/**
 * @module parsePipeline — THE ORDER, and nothing but the order (plan U22, phase 4 / KTD-12, KTD-13, KTD-15).
 *
 * DESIGN PATTERN: **Chain of Responsibility over ordered tiers, composed with Ports and Adapters** — the
 * deliberate sibling of `parseComparator.ts` and shaped after `resolutionCascade.ts`, which is this
 * repository's exemplar for a module that owns ONE rule. This one owns exactly one too:
 *
 * > **A human correction outranks a cached parse; a cached parse outranks an engine call; and the two
 * > engines are asked TOGETHER or not at all.**
 *
 * Everything else it appears to decide was decided elsewhere and is delegated: what a merged parse IS
 * (`parseComparator.ts`), what a stored row holds (`storedParseFacts.ts`), what a person's correction means
 * (`promoteCorrection.ts`), what a key is (`@kitchensink/recipe-core/parsing/parse-key`), and what an
 * engine's output means (`promoteCrfReading.ts` / `promoteLlmParse.ts`, applied by the ADAPTER behind
 * {@link ParseEnginePort}).
 *
 * ## ⛔ EVERY PORT IS BATCH, AND THE DIRECTION IS WHAT DECIDES IT
 *
 * Both transports behind this are batch-native and were built that way BEFORE this module existed:
 *
 *  - `ingredient-parser`'s `engineRequestSchema` takes `lines: array().min(1).max(200)` and answers "one
 *    result per submitted line, in the order they were submitted", with failure PER LINE because "a batch of
 *    200 must not lose 199 parses to one sentence the CRF chokes on".
 *  - `cookbook-import`'s local sidecar runs ONE Python process for a whole corpus, because
 *    `ingredient-parser-nlp` loads a CRF model at import and per-line spawning "would turn a two-second job
 *    into a quarter of an hour".
 *  - `ParseCacheDal.findForLines` is already a batch read, and the TABLE it reads calls that read "the
 *    pipeline's hottest read" — in `ingredientParseCache.ts`'s index note, not in the DAL's own docstring —
 *    written for this caller before this caller existed.
 *
 * ⛔ So a per-line `parse(line)` port would be an Adapter that adds behaviour — it would have to hide a
 * scheduler, or invoke a Lambda once per line and pay a cold start each time. **A batch port can be honestly
 * served by a loop; a per-line port cannot be honestly served by a batch transport.** The direction decides
 * it, and it decides it the same way for the cache.
 *
 * ⚠️ {@link ParseCorrectionsPort} is the ONE per-line port, and that is the same rule applied honestly:
 * `findInForce` is a per-line read on both sides of the seam — the shipped adapter's statement and
 * `recipe-service`'s `ParseCorrectionsDal.findInForce` alike — and there is no batch transport for it to
 * hide. The pipeline issues those reads CONCURRENTLY instead. The day a batch read exists, this port
 * changes — a small change inside one shared package, not a wire contract.
 *
 * ⛔ Chunking to the Lambda's `MAX_LINES` is the ADAPTER's job, not this module's. That bound is a fact
 * about one transport; another transport (the local sidecar) has a different one, and a pipeline that knew
 * either would be a pipeline that knows a transport.
 *
 * ## ⛔ WHY IT LIVES HERE AND NOT IN `recipe-workers` — ADR-0026 §6
 *
 * The plan puts this file in `packages/services/recipe-workers` while giving its integration test to
 * `packages/tools/cookbook-import`. Those two cannot both be true: that package exports only `"./infra"`,
 * so the tool cannot import from it at all, and adding a `./src` export to a deployable is the exact
 * coupling `recipe-workers/src/common/db.ts` refuses for the mirror case. It would also drag `aws-cdk-lib`,
 * five AWS SDK clients, `pg` and `drizzle-orm` into a tools package that needs none of them.
 *
 * ⛔ The GATED Bedrock leg does NOT follow it out. ADR-0024 §4b grants `bedrock:InvokeModel` to exactly one
 * Lambda execution role, guard-tested by set equality; hoisting the gated call into a shared package makes
 * a second, ungated grantee the natural next step, which is precisely the bypass layer 4 cannot detect. What
 * is shared is the ORCHESTRATION. The spend governance stays with the caller, which is why
 * {@link ParseEnginePort} says nothing about how an answer is obtained or paid for.
 *
 * ## ⛔ `Promise.allSettled`, NEVER `Promise.all` — KTD-12 is a PIPELINE invariant
 *
 * A CRF Lambda that threw, or an LLM call ADR-0024's ceiling denied, is **absence, not dissent**.
 * `compareParses` already gets that right — it answers `single-engine`, naming the engine that ANSWERED —
 * but only if the rejection never escapes this module. With `Promise.all`, one engine's rejection discards
 * the OTHER engine's good answer, already in hand, and takes every line of the batch down with it. Both
 * halves of that are silent: the corpus simply has fewer lines in it.
 *
 * ⚠️ The failure direction matters as much as the containment. `single-engine` folded into `differ` would
 * inflate the disagreement rate by however often an engine was down and turn a transient outage into a
 * permanent fact about an ingredient — the error `resolutionCascade.ts` names for `unavailable` versus
 * `consulted`, and the rule `contractSkew.ts` states as "ABSENCE IS SILENCE, never a mismatch".
 *
 * ## ⛔ A CORRECTION IS NOT AN ADJUDICATION — so it has NO `agreement` MEMBER AT ALL
 *
 * A cook is neither engine, and counting their answer in an agreement rate would put lines no engine ever
 * read into the denominator U23's oracle is calibrated against. That is expressed STRUCTURALLY, following
 * `ParseComparison`'s own precedent ("a union rather than `{ merged: ParsedLine | null; agreement }`, so
 * 'both unavailable resolves nothing' is a fact the TYPE carries"): the correction member has no
 * `agreement` key, so a rate-counting consumer writes `'agreement' in outcome` and a human's answer cannot
 * enter a measured rate by accident. A nullable member would have been a second representation of the same
 * fact `tier` already carries.
 *
 * ## Failure is CONTAINED and REPORTED, and is never equated with a miss
 *
 * Every tier here can fail without a line failing: an unreachable correction store, a cache read that
 * throws, a row from a superseded generation, a write the database refuses. Each is reported and the run
 * continues, because the alternative — a stale cache row taking down a parse it exists to accelerate — is
 * strictly worse than the extra call.
 *
 * ⚠️ {@link ParsePipelineObservers} has TWO members on purpose. A tier whose I/O failed and a single row
 * that could not be READ are different facts leading to different actions, and collapsing them makes "the
 * database is down" and "one row is stale-shaped" the same alarm — which is how a real warning gets muted.
 * Both are required rather than optional-and-defaulted, so a caller cannot acquire a silently-degrading
 * pipeline by omission; each report's own failure is swallowed, because observability must never become an
 * availability dependency.
 *
 * ## ⚠️ Preconditions, stated rather than defended
 *
 * Every port key is REQUIRED (KTD-18). An optional port reads as "this tier is available when convenient",
 * and a consumer that meant to wire a cache and forgot would silently run without one — paying for two
 * engine calls per line forever with nothing failing. A consumer that genuinely has no database says so
 * explicitly, with {@link NO_CACHE} and {@link NO_CORRECTIONS}.
 */
import { lineDigest, parseKey, type HexDigest, type LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import {
    normalizedIngredientKey,
    type NormalizedIngredientKey,
} from '@kitchensink/recipe-core/resolution/normalized-key';

import type { ParsedFacts, ParsedLine, ParseEngine } from '../parsedLine.js';

import { compareParses, type EngineAnswer, type ParseAgreement, type ResolvedAgreement } from './parseComparator.js';
import { promoteCorrection } from './promoteCorrection.js';
import { readStoredParseFacts, rehydrateEngineParse, storedFactsOf } from './storedParseFacts.js';

/**
 * A tier of the chain, for reporting.
 *
 * ⚠️ The two ENGINES are members in their own right rather than one `engines` value: "the CRF is down" and
 * "the model leg is down" lead to different actions, and ADR-0026's own residual-risk note asks a reader to
 * "watch the `single-engine` rate after the first deploy" — which is unanswerable if both engines report
 * under one name.
 */
export type ParsePipelineTier = 'corrections' | 'cache' | ParseEngine;

/** The correction in force for a line, as the store hands it over. */
export interface CorrectionInForce {
    /**
     * The corrected parse, EXACTLY as it was stored.
     *
     * ⛔ `unknown`, deliberately. It comes out of a `jsonb` column that may outlive the shape that wrote it,
     * and a port typed `ParsedFacts` would let an adapter satisfy the contract with a cast — putting the one
     * decision that matters (is this row this generation's shape?) somewhere this module cannot see it.
     */
    readonly facts: unknown;
}

/**
 * TIER 1 — the corrections a person made.
 *
 * DESIGN PATTERN: **Port**. The shipped adapter is `recipe-workers`' `createParseCorrectionsPort`
 * (`src/parsing/parsePorts.ts`), raw SQL over the worker seam; `cookbook-import` runs {@link NO_CORRECTIONS}
 * instead. ⛔ That adapter's statement MIRRORS `recipe-service`'s `ParseCorrectionsDal.findInForce`
 * predicate for predicate, because those `WHERE` clauses ARE the authorization and two readers with
 * different precedence would let a correction bind on the API path and not on the import path. Nothing here
 * re-derives any of it.
 */
export interface ParseCorrectionsPort {
    /**
     * The correction binding this line for this caller.
     *
     * @param normalizedKey - The line's match grain.
     * @param userId - The requesting cook, or `undefined` for an unattended import — which must see global
     *   corrections and NOBODY's personal ones.
     * @returns The correction in force, or `undefined` when nothing binds this line for this caller.
     * @sideEffect Reads the correction store.
     */
    findInForce(
        normalizedKey: NormalizedIngredientKey,
        userId: string | undefined,
    ): Promise<CorrectionInForce | undefined>;
}

/** One engine's stored parse of one line. */
export interface CachedParseRow {
    /** Which line it is about. Carried so this port can mirror the DAL, which returns rows unordered. */
    readonly lineDigest: LineDigest;
    /** Which engine produced it. A member of the KEY, not an attribute (KTD-13). */
    readonly engine: ParseEngine;
    /** The engine's own version. A row whose version is not the port's current one is NOT a hit. */
    readonly engineVersion: string;
    /** The row's payload. ⛔ `unknown` for the same reason {@link CorrectionInForce.facts} is. */
    readonly parse: unknown;
}

/** What {@link ParseCachePort.remember} is asked to store. */
export interface RememberedParse {
    /** `{version}:{sha256hex}` over the whole identity — derived HERE, so one module owns the derivation. */
    readonly parseKey: string;
    /** `{version}:{sha256hex}` over the source line. */
    readonly lineDigest: LineDigest;
    readonly engine: ParseEngine;
    readonly engineVersion: string;
    /** ⛔ The FACTS, never the whole parse — see `storedParseFacts.ts` on why the cook's line stays out. */
    readonly parse: ParsedFacts;
}

/**
 * TIER 2 — what an engine already said about these lines.
 *
 * DESIGN PATTERN: **Port**, mirroring `recipe-service`'s `ParseCacheDal` statement for statement. The
 * shipped adapter is `recipe-workers`' `createParseCachePort` (`src/parsing/parsePorts.ts`);
 * `cookbook-import` runs {@link NO_CACHE}. Its write is `ON CONFLICT DO NOTHING` by design: a row is
 * write-once within its generation, so a redelivered message and two concurrent misses are both benign.
 */
export interface ParseCachePort {
    /**
     * Every engine's stored parse for a batch of lines, UNORDERED.
     *
     * ⛔ EVERY engine, and every row. Narrowing this to one row per line would hand the comparator a single
     * parse to adjudicate against itself — reporting `agree` on every line, forever, with nothing failing.
     * The rows carry their own `lineDigest` and this module groups them, exactly as the DAL's docstring says
     * its caller does; a positionally-indexed answer would add a zip nobody needs to get wrong.
     *
     * @param digests - The lines to look up. An EMPTY batch must not reach the database (`in ()` is a
     *   syntax error in PostgreSQL), and this module never sends one.
     * @returns The rows found. A line nothing was stored for contributes none.
     * @sideEffect Reads the cache.
     */
    findForLines(digests: readonly LineDigest[]): Promise<readonly CachedParseRow[]>;
    /**
     * Store one engine's parse, if this generation does not already hold one for it.
     *
     * @param entry - The parse to remember.
     * @sideEffect Writes to the cache.
     */
    remember(entry: RememberedParse): Promise<void>;
}

/**
 * TIER 3 — one engine's reading of a batch of lines.
 *
 * DESIGN PATTERN: **Port**, and the seam that keeps ADR-0026 §1's independence true: it takes SOURCE LINES
 * and nothing else. There is no options bag and no context parameter a rival engine's answer could occupy,
 * which is the same property `buildParsePrompt`'s signature carries one layer down — and for the same reason,
 * stated by the owner: _"we have to be careful not to send the failed result from the CRF Lambda or any
 * context of it so we don't poison it."_
 */
export interface ParseEnginePort<E extends ParseEngine = ParseEngine> {
    /**
     * Which engine this is.
     *
     * ⛔ On the PORT, and the deps bundle is keyed by the same value, so wiring the model adapter under
     * `crf` is a COMPILE error rather than a corpus where every figure is labelled with the wrong engine.
     */
    readonly engine: E;
    /**
     * The engine's own version — the CRF package + model pin, or the LLM's model id + prompt version.
     *
     * ⛔ Known BEFORE the call, and that is what makes the cache lookup exact. `ingredient_parse_cache` is
     * keyed on `(lineDigest, engine, engineVersion)`, so a reader that could not name the version before
     * calling would have to match on the engine alone and would serve parses produced by a package or a
     * model that is no longer installed.
     *
     * ⛔ CONTRACT ON THE ADAPTER: a transport that ALSO reports a version (the CRF Lambda's response carries
     * `engineVersion`, "read from its installed metadata") MUST assert it equals this and throw if it does
     * not. ADR-0022's residual risk is that "nothing orders two CDK apps", so a stale declaration is
     * reachable — and a row written under the wrong version is permanent within its generation, because the
     * write is `DO NOTHING`.
     */
    readonly engineVersion: string;
    /**
     * Read a batch of lines.
     *
     * @param lines - The lines, byte-identical. ⛔ The ONLY parameter — see this interface's docstring.
     * @returns EXACTLY one answer per line, in the order the lines were given. A line this engine could not
     *   read is `EngineUnavailable` — never a `ParsedLine` with empty fields, because "the engine had no
     *   opinion" and "the engine read the line and found no food" are different facts. Rejecting the whole
     *   batch is also legitimate; the pipeline reads it as absence for every line in it.
     * @sideEffect Performs this engine's own I/O, and may be billed.
     */
    parse(lines: readonly string[]): Promise<readonly EngineAnswer[]>;
}

/** Both engines, keyed by the value each one carries. */
export interface ParseEnginePorts {
    /** The conditional-random-field parser (`ingredient-parser-nlp`). */
    readonly crf: ParseEnginePort<'crf'>;
    /** The Bedrock parse leg. */
    readonly llm: ParseEnginePort<'llm'>;
}

/** Everything a run needs. ⛔ Every key REQUIRED — see the module header on KTD-18. */
export interface ParsePipelineDeps {
    readonly corrections: ParseCorrectionsPort;
    readonly cache: ParseCachePort;
    readonly engines: ParseEnginePorts;
    /**
     * The hash the keys are taken over.
     *
     * A Port so this module carries no crypto dependency, exactly as `parseKey.ts` does — and the same
     * function, so a caller cannot satisfy one and not the other.
     */
    readonly digest: HexDigest;
}

/** Per-run facts, distinct from the collaborators a run is given. */
export interface ParsePipelineContext {
    /**
     * The requesting cook, or `undefined` for an unattended import.
     *
     * ⛔ `undefined` is not "a user we did not bother to look up": it means NOBODY is present, and the
     * correction tier treats it as such — global corrections only, and nobody's personal ones (R22).
     */
    readonly userId: string | undefined;
}

/**
 * A STORED payload that was not this generation's shape.
 *
 * ⚠️ It carries an IDENTITY and no error. zod's issue list quotes the payload, and a stored parse holds food
 * names a cook typed; relaying that into a log to explain a cache miss would put user text somewhere KTD-14
 * spent a whole table design keeping it out of. The identity is what an operator needs to find and reclaim
 * the row.
 */
export type UnreadablePayload =
    | { readonly tier: 'corrections'; readonly normalizedKey: NormalizedIngredientKey }
    | {
          readonly tier: 'cache';
          readonly lineDigest: LineDigest;
          readonly engine: ParseEngine;
          readonly engineVersion: string;
      };

/** How a run reports what went wrong without failing a line for it. */
export interface ParsePipelineObservers {
    /**
     * A tier's I/O failed — the store was unreachable, the engine threw, the write was refused.
     *
     * @param tier - Which tier.
     * @param error - What it threw.
     */
    readonly onTierFailure: (tier: ParsePipelineTier, error: unknown) => void;
    /**
     * A tier ANSWERED, and one of its stored rows could not be read.
     *
     * ⛔ NOT a tier failure — see the module header. Reported separately so a superseded generation shows up
     * as what it is (rows to reclaim) rather than as an outage.
     *
     * @param payload - Which row, by identity.
     */
    readonly onUnreadablePayload: (payload: UnreadablePayload) => void;
}

/**
 * What the pipeline concluded about ONE line.
 *
 * ⛔ The correction member has NO `agreement` key at all — see the module header. `fromCache` names the
 * engines whose answer came off the cache, so "a cache hit calls no engine" is a property of the RESULT
 * rather than something a caller can only observe with a spy, and so the hit rate is a number this module
 * can report and nothing else can.
 */
export type ParsePipelineOutcome =
    | { readonly tier: 'correction'; readonly parsed: ParsedLine }
    | {
          readonly tier: 'parse';
          readonly parsed: ParsedLine;
          readonly agreement: ResolvedAgreement;
          readonly fromCache: readonly ParseEngine[];
      }
    | {
          readonly tier: 'parse';
          readonly parsed: null;
          readonly agreement: Extract<ParseAgreement, { kind: 'neither' }>;
          readonly fromCache: readonly ParseEngine[];
      };

/**
 * A correction tier for a consumer that has none.
 *
 * DESIGN PATTERN: **Null Object**. `cookbook-import` runs with this deliberately: it has no `pg` and no
 * `drizzle-orm`, reaching the recipe service's DALs over HTTP would mean a new wire surface plus everything
 * ADR-0014 and GR-017 attach to one, and the tier is semantically inapplicable there anyway — with no caller
 * identity, `findInForce(key, undefined)` returns only `global` corrections and the 1919 corpus has none.
 *
 * ⚠️ FROZEN, like {@link NO_CACHE}. It is a process-wide singleton, so a consumer that assigned a method
 * onto it would silently change every other consumer's pipeline.
 */
export const NO_CORRECTIONS: ParseCorrectionsPort = Object.freeze({
    async findInForce(): Promise<CorrectionInForce | undefined> {
        return undefined;
    },
});

/**
 * A parse cache for a consumer that has none.
 *
 * DESIGN PATTERN: **Null Object**. It never hits and never refuses a write, so a consumer without a
 * database pays for both engines on every line — which is the honest price of not having one, and is
 * visible in the bill rather than hidden behind an omitted port.
 */
export const NO_CACHE: ParseCachePort = Object.freeze({
    async findForLines(): Promise<readonly CachedParseRow[]> {
        return [];
    },
    async remember(): Promise<void> {
        // Deliberately empty: there is nowhere to remember it.
    },
});

/** Both engines, in the order every per-engine report and every write is emitted in. */
const ENGINES: readonly ParseEngine[] = ['crf', 'llm'];

/** The marker `compareParses` reads as "this engine produced no answer at all". */
const UNAVAILABLE: EngineAnswer = { unavailable: true };

/**
 * Report without letting the report itself fail the run.
 *
 * @param sink - The caller-supplied observer call, already bound to its argument.
 * @sideEffect Calls the caller-supplied sink.
 */
function report(sink: () => void): void {
    try {
        sink();
    } catch {
        // Deliberately empty. A broken sink degrades the signal; it must never degrade the parse, and there
        // is nowhere left to report a reporting failure to.
    }
}

/**
 * TIER 1 — the correction in force for each line, where there is one and it can be read.
 *
 * The reads are issued CONCURRENTLY: they are independent per-line reads against one store, and running a
 * 200-line batch through them one await at a time would make the tier's latency the batch size.
 *
 * @param deps - The ports.
 * @param keys - Each line's match grain, or `undefined` where the line has none.
 * @param lines - The source lines, positionally.
 * @param context - The requesting cook, or its absence.
 * @param observers - Where a failure is reported.
 * @returns One entry per line: the corrected parse, or `undefined`.
 * @sideEffect Reads the correction store; reports failures.
 */
async function consultCorrections(
    deps: ParsePipelineDeps,
    keys: readonly (NormalizedIngredientKey | undefined)[],
    lines: readonly string[],
    context: ParsePipelineContext,
    observers: ParsePipelineObservers,
): Promise<readonly (ParsedLine | undefined)[]> {
    const settled = await Promise.allSettled(
        keys.map(async (key) =>
            // A line with no visible content has no match grain, so there is nothing a correction could bind
            // TO. Asking anyway would key the store on a value the smart constructor refused to mint.
            key === undefined ? undefined : deps.corrections.findInForce(key, context.userId),
        ),
    );

    return settled.map((outcome, index) => {
        if (outcome.status === 'rejected') {
            report(() => observers.onTierFailure('corrections', outcome.reason));

            return undefined;
        }

        if (outcome.value === undefined) {
            return undefined;
        }

        const facts = readStoredParseFacts(outcome.value.facts);

        if (facts === undefined) {
            // ⛔ Loud, not silent. A correction that stops applying is precisely the failure U21 exists to
            // prevent, and falling through to the engines makes it look like the cook never corrected it.
            report(() =>
                observers.onUnreadablePayload({
                    tier: 'corrections',
                    normalizedKey: keys[index] as NormalizedIngredientKey,
                }),
            );

            return undefined;
        }

        return promoteCorrection(facts, lines[index] as string);
    });
}

/**
 * TIER 2 — the engines' stored answers, at the versions actually installed.
 *
 * @param deps - The ports.
 * @param digests - The DISTINCT digests to look up. An empty batch never reaches the port.
 * @param observers - Where a failure is reported.
 * @returns A parse per `(digest, engine)` whose row was found, current and readable, keyed
 *   `"{digest} {engine}"` — a space, which neither a digest nor an engine name contains. A read that throws yields none.
 * @sideEffect Reads the cache; reports failures.
 */
async function consultCache(
    deps: ParsePipelineDeps,
    digests: readonly LineDigest[],
    observers: ParsePipelineObservers,
): Promise<ReadonlyMap<string, ParsedFacts>> {
    const hits = new Map<string, ParsedFacts>();

    if (digests.length === 0) {
        return hits;
    }

    let rows: readonly CachedParseRow[];

    try {
        rows = await deps.cache.findForLines(digests);
    } catch (error) {
        report(() => observers.onTierFailure('cache', error));

        return hits;
    }

    for (const row of rows) {
        // ⛔ The FULL identity, never the engine alone (KTD-13). A row written by a superseded package pin
        // or a retired model is not this engine's answer; it is a different engine that happens to share a
        // name, and serving it would put a parse nobody can reproduce into a comparison.
        if (row.engineVersion !== deps.engines[row.engine].engineVersion) {
            continue;
        }

        const facts = readStoredParseFacts(row.parse);

        if (facts === undefined) {
            report(() =>
                observers.onUnreadablePayload({
                    tier: 'cache',
                    lineDigest: row.lineDigest,
                    engine: row.engine,
                    engineVersion: row.engineVersion,
                }),
            );
            continue;
        }

        hits.set(cacheSlot(row.lineDigest, row.engine), facts);
    }

    return hits;
}

/**
 * The key one engine's cached answer to one line is held under, in memory.
 *
 * @param digest - The line's digest.
 * @param engine - The engine.
 * @returns A composite key. Pure.
 */
function cacheSlot(digest: LineDigest, engine: ParseEngine): string {
    return `${digest} ${engine}`;
}

/**
 * Ask both engines, TOGETHER, for the lines each of them is missing.
 *
 * ⛔ Both promises are created by `map` BEFORE anything is awaited, so the two calls are genuinely in flight
 * at once. Awaiting them one at a time would double the wall-clock cost of every uncached batch and — worse
 * — would let the first engine's rejection prevent the second from being asked at all, which is `neither`
 * reported for lines one engine could read perfectly well.
 *
 * @param deps - The ports.
 * @param missing - Per engine, the distinct lines it must read.
 * @param observers - Where a failure is reported.
 * @returns Per engine, one answer per line it was asked about, in order. An engine whose batch REJECTED
 *   contributes an empty list, which the caller reads as absence for every line — the correct outcome under
 *   KTD-12, and the one ADR-0026 predicts for a CRF leg that fails to import.
 * @throws When an engine ANSWERED with a different number of answers than it was asked for.
 * @sideEffect Calls the engines, which perform I/O and may be billed; reports failures.
 */
async function consultEngines(
    deps: ParsePipelineDeps,
    missing: Readonly<Record<ParseEngine, readonly string[]>>,
    observers: ParsePipelineObservers,
): Promise<Record<ParseEngine, readonly EngineAnswer[]>> {
    const asked = ENGINES.filter((engine) => missing[engine].length > 0);
    const settled = await Promise.allSettled(asked.map(async (engine) => deps.engines[engine].parse(missing[engine])));
    const answers: Record<ParseEngine, readonly EngineAnswer[]> = { crf: [], llm: [] };
    const mispaired: string[] = [];

    settled.forEach((outcome, index) => {
        const engine = asked[index] as ParseEngine;

        if (outcome.status === 'rejected') {
            // ⛔ KTD-12. Contained and reported — never rethrown, and never turned into an empty parse.
            report(() => observers.onTierFailure(engine, outcome.reason));

            return;
        }

        if (outcome.value.length !== missing[engine].length) {
            mispaired.push(`the ${engine} engine answered ${outcome.value.length} of ${missing[engine].length} lines`);

            return;
        }

        answers[engine] = outcome.value;
    });

    // ⛔ THE ONE FAILURE THAT IS NOT CONTAINED, and the split is the point. A REJECTED batch is a runtime
    // condition — the Lambda was down, the ceiling denied the call — and is absence. A batch that ANSWERED
    // the wrong number of lines is a defect in the adapter: every answer after the gap is paired with the
    // WRONG line, and `crfProcess.ts` records that as the one failure which "corrupts the headline result
    // silently and totally", because every figure derived from it still looks perfectly clean. There is no
    // correct partial reading of a mispaired stream, so it is THROWN rather than degraded — and it is
    // raised after the settle, from the FULFILLED branch only, so it can never be mistaken for an outage
    // and an outage can never be mistaken for it.
    if (mispaired.length > 0) {
        throw new Error(`parsePipeline: ${mispaired.join('; ')} — the batch is mispaired`);
    }

    return answers;
}

/**
 * Store what an engine just said, and let a refusal cost a future call rather than this one.
 *
 * @param deps - The ports.
 * @param writes - The freshly-answered `(digest, engine, parse)` triples. Cached answers are not re-written.
 * @param observers - Where a failure is reported.
 * @sideEffect Writes to the cache; reports failures.
 */
async function rememberFresh(
    deps: ParsePipelineDeps,
    writes: readonly { readonly digest: LineDigest; readonly engine: ParseEngine; readonly parse: ParsedLine }[],
    observers: ParsePipelineObservers,
): Promise<void> {
    const settled = await Promise.allSettled(
        writes.map(async ({ digest, engine, parse }) => {
            const engineVersion = deps.engines[engine].engineVersion;

            await deps.cache.remember({
                parseKey: parseKey({ lineDigest: digest, engine, engineVersion }, deps.digest),
                lineDigest: digest,
                engine,
                engineVersion,
                parse: storedFactsOf(parse),
            });
        }),
    );

    for (const outcome of settled) {
        if (outcome.status === 'rejected') {
            // The parse succeeded. Failing the line because the cache would not take it would cost a correct
            // answer in order to save a future call — exactly backwards.
            report(() => observers.onTierFailure('cache', outcome.reason));
        }
    }
}

/**
 * Parse a batch of lines: a correction where there is one, else the cache, else both engines — and
 * adjudicate.
 *
 * ⚠️ Lines that share a digest are asked about ONCE. The digest IS the definition of "the same line"
 * (NFC-normalized, whitespace-collapsed, case-preserving), so asking twice would pay a second billed call
 * for one question — and, the LLM leg not being deterministic, could put two different readings of one line
 * into one recipe. Each position still gets its OWN `raw`, byte-identical (HAZ-041): the digest asserts the
 * two spellings are the same line, not that they are the same string.
 *
 * @param lines - The lines to parse, in order. An empty batch consults nothing and returns nothing.
 * @param deps - The ports and the digest. Every key required (KTD-18).
 * @param context - The requesting cook, or its absence.
 * @param observers - Where a failed tier and an unreadable row are reported. Required, so a caller cannot
 *   omit them into silence.
 * @returns EXACTLY one outcome per input line, in order.
 * @throws When an engine answers a different number of lines than it was asked — see `consultEngines`, which raises it only from the FULFILLED branch so an outage can never be mistaken for it.
 * @sideEffect Reads the correction store and the cache, calls the engines, and writes back what they said.
 */
export async function runParsePipeline(
    lines: readonly string[],
    deps: ParsePipelineDeps,
    context: ParsePipelineContext,
    observers: ParsePipelineObservers,
): Promise<readonly ParsePipelineOutcome[]> {
    if (lines.length === 0) {
        return [];
    }

    const keys = lines.map((line) => normalizedIngredientKey(line));
    const corrected = await consultCorrections(deps, keys, lines, context, observers);

    // ⛔ STOP, per line. KTD-15: a correction outranks the cache and both engines, so a corrected line
    // contributes NOTHING below — not a digest, not a cache read, and not an engine call.
    const machineIndices = lines.map((_line, index) => index).filter((index) => corrected[index] === undefined);
    const digests = new Map<number, LineDigest>(
        machineIndices.map((index) => [index, lineDigest(lines[index] as string, deps.digest)]),
    );
    const distinct = [...new Set(digests.values())];
    const cached = await consultCache(deps, distinct, observers);

    // One representative line per distinct digest, so an engine is asked about a line once.
    const representative = new Map<LineDigest, string>();

    for (const index of machineIndices) {
        const digest = digests.get(index) as LineDigest;

        if (!representative.has(digest)) {
            representative.set(digest, lines[index] as string);
        }
    }

    const missingByEngine = { crf: [], llm: [] } as Record<ParseEngine, LineDigest[]>;

    for (const digest of distinct) {
        for (const engine of ENGINES) {
            if (!cached.has(cacheSlot(digest, engine))) {
                missingByEngine[engine].push(digest);
            }
        }
    }

    const answers = await consultEngines(
        deps,
        {
            crf: missingByEngine.crf.map((digest) => representative.get(digest) as string),
            llm: missingByEngine.llm.map((digest) => representative.get(digest) as string),
        },
        observers,
    );

    /** Every freshly-read parse, by `(digest, engine)`. */
    const fresh = new Map<string, ParsedLine>();
    const writes: { digest: LineDigest; engine: ParseEngine; parse: ParsedLine }[] = [];

    for (const engine of ENGINES) {
        missingByEngine[engine].forEach((digest, position) => {
            const answer = answers[engine][position];

            if (answer === undefined || 'unavailable' in answer) {
                return;
            }

            fresh.set(cacheSlot(digest, engine), answer);
            writes.push({ digest, engine, parse: answer });
        });
    }

    if (writes.length > 0) {
        await rememberFresh(deps, writes, observers);
    }

    return lines.map((line, index) => {
        const correction = corrected[index];

        if (correction !== undefined) {
            return { tier: 'correction', parsed: correction };
        }

        const digest = digests.get(index) as LineDigest;
        const fromCache: ParseEngine[] = [];

        /**
         * One engine's answer for THIS position — a cached row rehydrated, a fresh reading re-stamped, or
         * absence.
         *
         * ⚠️ `raw` is re-stamped to this position's own line. Two positions sharing a digest were asked about
         * ONCE, under whichever spelling came first; the digest says they are the same LINE, not the same
         * STRING, and HAZ-041 is about the string.
         */
        const answerFor = (engine: ParseEngine): EngineAnswer => {
            const hit = cached.get(cacheSlot(digest, engine));

            if (hit !== undefined) {
                fromCache.push(engine);

                return rehydrateEngineParse(hit, line, engine);
            }

            const answered = fresh.get(cacheSlot(digest, engine));

            return answered === undefined ? UNAVAILABLE : { ...answered, raw: line };
        };

        // ⛔ Spelled out rather than assembled from `ENGINES`, so "which engine" is never "which key a
        // `fromEntries` happened to produce" — the same reason `EngineAnswers` is a named pair in the first
        // place. It also keeps the whole path free of a cast.
        const comparison = compareParses({ crf: answerFor('crf'), llm: answerFor('llm') });

        return comparison.merged === null
            ? { tier: 'parse', parsed: null, agreement: comparison.agreement, fromCache }
            : { tier: 'parse', parsed: comparison.merged, agreement: comparison.agreement, fromCache };
    });
}
