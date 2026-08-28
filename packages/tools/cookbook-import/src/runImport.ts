/**
 * The import RUN: segment a cookbook, map its blocks, resolve each ingredient through the product's own
 * path, and create the recipes through `POST /api/v1/recipes`.
 *
 * DESIGN PATTERN: **Orchestration over pure stages and one port.** Everything that can be pure is pure and
 * lives elsewhere (`gutenbergBook.adapter`, `proseRecipe`, `@kitchensink/recipe-import-core`); this module
 * owns only sequencing, I/O and measurement.
 *
 * ## Sequential on purpose
 *
 * One recipe at a time, one ingredient at a time. Concurrency would buy minutes on a one-shot curation
 * errand and cost the two things that matter here: a rate-limit interaction that is trivially correct, and
 * a ledger whose ordering means something when a run is interrupted. `RecipeApiClient` already retries a
 * `429`/`503` with backoff, honouring `Retry-After`.
 *
 * ## ⛔ THE PARSE OBSERVATION IS OBSERVE-ONLY, AND THAT IS A DECISION (U22)
 *
 * The two-engine pipeline reads every accepted ingredient line in ONE batch, and what it concludes is
 * RECORDED. It does not decide what goes on the wire. Two independent reasons, both of which have to stop
 * holding before that changes:
 *
 *  1. **ADR-0026 says so.** Its residual-risk list records the field-level winner rule as "evidence-SHAPED,
 *     not evidence-BACKED … nobody has decided who is right on the residual list. **Observe-only until it
 *     lands**", and U23's oracle has not run.
 *  2. **Substituting it would detach R35's disclosure from the values it discloses.** `restateHistoricalUnit`
 *     rewrites a line's `quantity`/`unit` INSIDE `toCandidateRecipe`, and `buildDescription` states that
 *     conversion in the recipe's persisted description. The comparator's `llmRescuedTheMeasure` is exactly
 *     the path that reads a gill the CRF is blind to — so a naive substitution would publish an un-restated
 *     `1 gill` under a description claiming the measures were converted. Both halves wrong, both silent, and
 *     firing on precisely the historical-measure lines the feature exists to improve.
 *
 * ⚠️ Promoting the pipeline to the authority is therefore not a wiring change: it needs the oracle, and it
 * needs the restatement and the description to be rebuilt FROM the pipeline's reading rather than beside it.
 * `__tests__/runImport.test.ts` asserts the create requests are byte-identical with the observation on and
 * off, so that promotion cannot happen by accident.
 *
 * ## The settle pass
 *
 * Ingredient resolution is ASYNCHRONOUS — `POST /ingredients/by-name` answers `202 PENDING` while the food
 * service goes and looks the name up. Counting a `PENDING` as a failure would under-report the system's
 * ability, so after every recipe is created the run RE-READS each food-backed ingredient's status for a
 * bounded window and reports what settled, and what had not by the time it stopped waiting.
 *
 * @sideEffect Network I/O, filesystem I/O (the ledger), and console output.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import {
    runParsePipeline,
    type ParsedFacts,
    type ParsePipelineDeps,
    type ParsePipelineOutcome,
} from '@kitchensink/recipe-import-core';

import { assertPublicDomain, type Cookbook } from './cookbooks.js';
import { segmentCookbook, type CookbookBlock } from './gutenbergBook.adapter.js';
import { toCandidateRecipe, type RecipeCandidateOutcome } from './proseRecipe.js';
import { resolveIngredientLikeAUser, type IngredientResolutionPort } from './resolveIngredient.js';
import { toImportedIngredientLine } from './importedIngredientLine.js';
import {
    emptyObservation,
    emptyReport,
    recordDropped,
    recordHistoricalConversion,
    type ImportReportData,
    type ImportedExample,
    type ParseObservationData,
} from './importReport.js';
import type { ImportLedger } from './importLedger.js';
import type { CreateRecipeBody, Ingredient, RecipeDetail } from './RecipeApiClient.js';

/** Statuses that mean the food pipeline is still working; anything else is terminal. */
const NON_TERMINAL = new Set(['PENDING', 'UNRESOLVED']);

/** How many complete recipes the report keeps as worked examples. */
const MAX_EXAMPLES = 3;

/** Gap between settle sweeps. */
const POLL_INTERVAL_MS = 2000;

/** How many disagreeing lines the report keeps verbatim, for a reader who wants to see them. */
const MAX_DISAGREEMENTS = 20;

/**
 * The recipe-service calls this run makes.
 *
 * ⚠️ A PORT rather than `RecipeApiClient` itself, so the run is drivable from the unit tier without a
 * network — the same reason `resolveIngredient.ts` defines `IngredientResolutionPort` rather than taking the
 * client. `RecipeApiClient` satisfies it structurally and nothing at the call site changes.
 */
export interface ImportApiPort extends IngredientResolutionPort {
    /** `POST /api/v1/recipes`. */
    createRecipe(recipe: CreateRecipeBody): Promise<RecipeDetail>;
    /** `GET /api/v1/ingredients/{id}/status`. */
    getIngredientStatus(ingredientId: string): Promise<Ingredient>;
}

/**
 * Whether this run observes the two-engine parse pipeline, and with what.
 *
 * ⛔ A REQUIRED key holding a CLOSED union, never an optional one. `on` spends real money against ADR-0024's
 * shared $100 pool — the residual risk ADR-0026 names is that "a large import can starve the verification
 * gate" — so it must be an explicit decision at the call site. An optional key would let a caller acquire the
 * spend by forgetting, which is the same failure KTD-18 rules against for the pipeline's own ports.
 */
export type ParseObservation =
    | { readonly kind: 'off' }
    | {
          readonly kind: 'on';
          /** The pipeline's ports. `cookbook-import` supplies the two Null Objects (ADR-0026 §6). */
          readonly deps: ParsePipelineDeps;
          /**
           * What the model leg has spent, in micro-dollars.
           *
           * ⚠️ Read from the ADAPTER, never from the pipeline: nothing inside the orchestration may learn
           * about spend, the mirror of ADR-0024's rule that "nothing about the reservation … may learn about
           * the call site".
           */
          readonly spentMicros: () => number;
      };

/** Options for {@link runImport}. */
export interface RunImportOptions {
    /** The registry entry for the book being imported. */
    readonly book: Cookbook;
    /** The book's plain text, as the operator downloaded it. */
    readonly plainText: string;
    /** The recipe API, authenticated as the curator. */
    readonly client: ImportApiPort;
    /** The idempotency ledger. */
    readonly ledger: ImportLedger;
    /** Stop after creating this many recipes. */
    readonly limit: number;
    /** How long to keep re-reading non-terminal ingredient statuses, in milliseconds. */
    readonly settleMs: number;
    /** Whether to run the two-engine parse pipeline over this run's lines. ⛔ Required — see the type. */
    readonly parseObservation: ParseObservation;
    /** Where progress is written. */
    readonly log: (message: string) => void;
}

/** One block, and what the pure mapper made of it. */
interface Candidate {
    readonly block: CookbookBlock;
    readonly outcome: RecipeCandidateOutcome;
}

/**
 * The lines the run will actually attempt, so the observation never pays for lines it will not import.
 *
 * ⚠️ A BOUND, not a prediction. The create loop stops on `imported >= limit`, and a refused create does not
 * count toward that — so the loop may reach further than this and leave a few lines unobserved. The report
 * says how many lines were read; it never claims to have read them all.
 *
 * @param candidates - Every block, already mapped.
 * @param ledger - The idempotency ledger, so lines already imported are not re-read.
 * @param book - The book, for the ledger key.
 * @param limit - The run's own recipe limit.
 * @returns Each accepted line's SOURCE clause, in order.
 * @sideEffect Reads the ledger.
 */
function linesToObserve(
    candidates: readonly Candidate[],
    ledger: ImportLedger,
    book: Cookbook,
    limit: number,
): readonly string[] {
    const lines: string[] = [];
    let attempts = 0;

    for (const { block, outcome } of candidates) {
        if (attempts >= limit) {
            break;
        }

        if (outcome.kind === 'skipped' || ledger.has(book.ebookId, block.title)) {
            continue;
        }

        attempts += 1;
        // ⛔ `sourceText`, never `raw`. `raw` is what `parseIngredientLine` RECEIVED, after the scanner ran
        // `normalizeQuantity` — so `one gill of milk` reaches it as `1 gill of milk`. Handing an engine a
        // string WE produced from our own parse is the "gate that reports success by construction"
        // `recipeIngredientSourceLineSchema` refuses, one layer over.
        lines.push(...outcome.recipe.ingredients.map((ingredient) => ingredient.sourceText));
    }

    return lines;
}

/**
 * Read this run's lines with both engines, and record what they amounted to.
 *
 * ⛔ It records and returns; it changes nothing about what is sent. See the module header for why.
 *
 * @param observation - The caller's decision, and the ports if it said yes.
 * @param lines - The accepted lines' source clauses.
 * @param log - Where progress is written.
 * @returns What the pipeline concluded and its per-line readings, or `undefined` when this run did not
 *   observe. The readings are keyed by the source line the pipeline was given, which is the key
 *   `toCandidateRecipe` looks them up by.
 * @sideEffect Calls both engines; may be billed.
 */
async function observeParses(
    observation: ParseObservation,
    lines: readonly string[],
    log: (message: string) => void,
): Promise<{ readonly data: ParseObservationData; readonly readings: ReadonlyMap<string, ParsedFacts> } | undefined> {
    if (observation.kind === 'off') {
        return undefined;
    }

    const data = emptyObservation();

    log(`\nparsing ${lines.length} ingredient line(s) with both engines…`);

    const outcomes = await runParsePipeline(
        lines,
        observation.deps,
        // ⛔ An unattended import has NO caller, and the correction tier must treat it as such: global
        // corrections and nobody's personal ones (R22). `cookbook-import` runs `NO_CORRECTIONS` anyway, so
        // this is belt and braces — but the belt is the one that would matter if it ever acquired a store.
        { userId: undefined },
        {
            onTierFailure: (tier) => {
                data.tierFailures[tier] = (data.tierFailures[tier] ?? 0) + 1;
            },
            onUnreadablePayload: (payload) => {
                data.unreadablePayloads[payload.tier] = (data.unreadablePayloads[payload.tier] ?? 0) + 1;
            },
        },
    );

    recordObservations(data, lines, outcomes);
    data.spentMicros = observation.spentMicros();

    // ⛔ Keyed by the LINE the pipeline was given, because that is the key `toCandidateRecipe` looks up. A
    // `parsed: null` outcome (both engines silent) contributes nothing, so the line keeps the library parse.
    const readings = new Map<string, ParsedFacts>();

    for (const [index, outcome] of outcomes.entries()) {
        const line = lines[index];

        if (line !== undefined && outcome.parsed !== null) {
            readings.set(line, outcome.parsed);
        }
    }

    return { data, readings };
}

/**
 * Fold the pipeline's outcomes into the report's counters.
 *
 * ⛔ A correction is counted APART from the agreement census, never inside it. A cook is neither engine, and
 * folding their answer into an agreement rate would put lines no engine ever read into the denominator U23's
 * oracle is calibrated against — the same argument KTD-12 makes one tier down.
 *
 * @param data - The counters to fill.
 * @param lines - The lines that were read, positionally.
 * @param outcomes - What the pipeline concluded, one per line.
 * @sideEffect Mutates `data`.
 */
function recordObservations(
    data: ParseObservationData,
    lines: readonly string[],
    outcomes: readonly ParsePipelineOutcome[],
): void {
    data.lines = outcomes.length;

    outcomes.forEach((outcome, index) => {
        if (outcome.tier === 'correction') {
            data.corrected += 1;

            return;
        }

        data.agreement[outcome.agreement.kind] += 1;
        data.cacheHits += outcome.fromCache.length;

        if (outcome.agreement.kind === 'differ' && data.disagreements.length < MAX_DISAGREEMENTS) {
            data.disagreements.push({ line: lines[index] ?? '', fields: [...outcome.agreement.fields] });
        }
    });
}

/**
 * Run the import.
 *
 * @param options - The book, the transport, the ledger and the limits.
 * @returns The measurements this run produced.
 * @sideEffect Creates ingredients and recipes through the API; writes the ledger.
 */
export async function runImport(options: RunImportOptions): Promise<ImportReportData> {
    const { book, plainText, client, ledger, limit, settleMs, log } = options;

    // Verified against the actual bytes, every run — a copyrighted Gutenberg ebook must never be published
    // as `imported_public` under a user-visible attribution line.
    assertPublicDomain(plainText, book);

    const report = emptyReport(`${book.title} (Project Gutenberg #${book.ebookId})`);
    const blocks = segmentCookbook(plainText);
    report.headingsFound = blocks.length;

    // ⚠️ TWO PASSES, and the first one is PURE. `toCandidateRecipe` is a pipeline of pure synchronous stages
    // (which is why the parse observation is wired HERE and not inside it), so mapping every block up front
    // costs no I/O and lets the engines read the whole run in ONE batch. `crfProcess.ts` loads a CRF model at
    // import and warns that per-line spawning "would turn a two-second job into a quarter of an hour"; one
    // process per RECIPE is the same failure with a smaller constant.
    const candidates: readonly Candidate[] = blocks.map((block) => ({
        block,
        outcome: toCandidateRecipe(block, book),
    }));

    const observed = await observeParses(
        options.parseObservation,
        linesToObserve(candidates, ledger, book, limit),
        log,
    );

    report.parseObservation = observed?.data;

    // ⛔ THE THIRD PASS IS THE PROMOTION. `toCandidateRecipe` is re-run with the pipeline's readings so the
    // restatement and the persisted description are rebuilt FROM them — ADR-0026's condition for promoting
    // the pipeline, and the reason the readings are an INPUT rather than a patch applied to the result.
    //
    // ⚠️ Re-running is free of I/O (the function is pure) and the SEGMENTATION is unchanged, so a line the
    // scan refused stays refused. Without an observation this is the same array, so a run with the pipeline
    // off is byte-identical to before it existed.
    const finalCandidates: readonly Candidate[] =
        observed === undefined || observed.readings.size === 0
            ? candidates
            : blocks.map((block) => ({ block, outcome: toCandidateRecipe(block, book, observed.readings) }));

    /** Food-backed ingredient rows to re-read once the creates are done. */
    const pending = new Map<string, Ingredient>();

    for (const { block, outcome } of finalCandidates) {
        if (report.imported >= limit) {
            break;
        }

        if (outcome.kind === 'skipped') {
            report.skipped[outcome.reason] += 1;
            continue;
        }

        report.candidates += 1;
        recordDropped(report, outcome.droppedLines);

        if (ledger.has(book.ebookId, block.title)) {
            report.alreadyImported += 1;
            continue;
        }

        const { recipe } = outcome;
        const lines: CreateRecipeBody['ingredients'][number][] = [];
        const exampleLines: ImportedExample['lines'][number][] = [];

        for (const parsed of recipe.ingredients) {
            // ⛔ THE WIRE BOUNDARY — and since U8 there is NOTHING TO DO HERE. Keep it that way.
            //
            // This was the one place in the tool a quantity was narrowed or refused, because
            // `recipe_ingredients.quantity` was a required positive scalar: a stated range lost its upper
            // bound (counted as `rangeNarrowedAtWire`) and an unquantified line was DROPPED, because the
            // only number available to send was a `0` the wire's `0.001` floor rejected with a `400` that
            // refused the whole recipe. The column is now `exact | range | absent` end to end, so the
            // parser's own reading of the source travels to the service unaltered (R36, R40, R41).
            //
            // ⛔ Do not reintroduce a collapse here "to be safe". Every form the parser can produce is a
            // form the contract accepts — that is what `ingredientQuantitySchema` being the SAME object on
            // both sides buys — and a defensive `quantityLowerBound` would silently resume discarding upper
            // bounds with nothing to signal it.

            // ⛔ The name goes to the service EXACTLY as the prose gave it. See `resolveIngredient.ts`.
            const resolution = await resolveIngredientLikeAUser(client, parsed.name);

            report.ingredientLines += 1;
            report.resolutionKinds[resolution.kind] += 1;

            // R35 — a restated amount is not the amount the book printed, and the run says so under whose
            // authority. The reader-facing half of the same disclosure is in the recipe's description.
            if (parsed.unitConversion !== undefined) {
                recordHistoricalConversion(report, parsed.unitConversion);
            }

            if (resolution.catalogAvailability !== 'ok') {
                report.catalogUnavailable += 1;
            }

            const { ingredient } = resolution;

            if (ingredient.foodId !== undefined) {
                report.foodBacked += 1;
                pending.set(ingredient.id, ingredient);
            }

            lines.push(toImportedIngredientLine(parsed, ingredient));

            exampleLines.push({
                quantity: parsed.quantity,
                unit: parsed.unit ?? '',
                name: parsed.name,
                kind: resolution.kind,
                foodId: ingredient.foodId,
                foodResolutionStatus: ingredient.foodResolutionStatus,
            });
        }

        const body: CreateRecipeBody = {
            title: recipe.title,
            description: recipe.description,
            visibility: 'public',
            servings: recipe.servings,
            prepTimeMinutes: recipe.prepTimeMinutes,
            cookTimeMinutes: recipe.cookTimeMinutes,
            totalTimeMinutes: recipe.totalTimeMinutes,
            ingredients: lines,
            steps: recipe.steps.map((instruction) => ({ instruction })),
            source: {
                sourceType: 'imported_public',
                sourceUrl: book.sourceUrl,
                sourceAttribution: book.attribution,
            },
        };

        try {
            const created = await client.createRecipe(body);

            ledger.record(book.ebookId, block.title, created.id);
            report.imported += 1;
            log(`  created  ${recipe.title}  (${lines.length} lines)`);

            if (report.examples.length < MAX_EXAMPLES) {
                report.examples.push({ recipeId: created.id, title: recipe.title, lines: exampleLines });
            }
        } catch (error) {
            // A refused create is recorded and the run CONTINUES: one malformed candidate out of hundreds
            // must not discard the rest (004-FR-026's partial-failure rule, applied to a curation errand).
            report.failures.push({
                title: recipe.title,
                reason: error instanceof Error ? error.message : String(error),
            });
            log(`  REFUSED  ${recipe.title} — ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    await settleFoodResolution({ client, pending, report, settleMs, log });

    return report;
}

/**
 * Re-read every food-backed ingredient until it settles or the window closes.
 *
 * Resolution is asynchronous, so a `PENDING` at create time says nothing about whether the system could
 * match the name — only that it had not finished. Reporting the two as one number would make the product's
 * catalog coverage look worse than it is.
 *
 * @param input - The client, the rows to watch, the report to update and the window.
 * @sideEffect Network I/O; waits.
 */
async function settleFoodResolution(input: {
    client: ImportApiPort;
    pending: Map<string, Ingredient>;
    report: ImportReportData;
    settleMs: number;
    log: (message: string) => void;
}): Promise<void> {
    const { client, pending, report, settleMs, log } = input;
    const deadline = Date.now() + settleMs;
    const outstanding = new Map(pending);

    for (const [id, ingredient] of pending) {
        if (!NON_TERMINAL.has(ingredient.foodResolutionStatus ?? '')) {
            outstanding.delete(id);
        }
    }

    log(`\nsettling ${outstanding.size} non-terminal ingredient(s) for up to ${Math.round(settleMs / 1000)}s…`);

    while (outstanding.size > 0 && Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);

        for (const id of [...outstanding.keys()]) {
            // ⚠️ THE DEADLINE IS CHECKED HERE, INSIDE THE SWEEP — not only in the `while` above.
            //
            // Measured against live services, not theorised: `GET /ingredients/{id}/status` carries the
            // DEFAULT read rate limit (120/min — `RATE_LIMIT_WRITE` and `RATE_LIMIT_SEARCH` do not cover
            // it), which a sweep over a few hundred ingredients exhausts immediately. The client then
            // correctly honours `Retry-After` and backs off, so ONE sweep can run for many minutes and a
            // window advertised as "up to 60s" silently became unbounded. A settle window that cannot be
            // relied on is worse than none: the operator waits without knowing what they are waiting for.
            if (Date.now() >= deadline) {
                break;
            }

            const current = await client.getIngredientStatus(id);

            if (!NON_TERMINAL.has(current.foodResolutionStatus ?? '')) {
                outstanding.delete(id);
                pending.set(id, current);
            }
        }
    }

    if (outstanding.size > 0) {
        log(
            `  ${outstanding.size} ingredient(s) were still non-terminal when the settle window closed — ` +
                `reported as PENDING, never as unmatched.`,
        );
    }

    report.foodBackedIngredients = pending.size;

    for (const ingredient of pending.values()) {
        if (ingredient.foodResolutionStatus === 'RESOLVED') {
            report.foodResolvedIngredients += 1;
        } else if (NON_TERMINAL.has(ingredient.foodResolutionStatus ?? '')) {
            report.foodPendingIngredients += 1;
        }
    }
}
