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

import { assertPublicDomain, type Cookbook } from './cookbooks.js';
import { segmentCookbook } from './gutenbergBook.adapter.js';
import { toCandidateRecipe } from './proseRecipe.js';
import { resolveIngredientLikeAUser } from './resolveIngredient.js';
import { emptyReport, recordDropped, type ImportReportData, type ImportedExample } from './importReport.js';
import type { ImportLedger } from './importLedger.js';
import type { CreateRecipeBody, Ingredient, RecipeApiClient } from './RecipeApiClient.js';

/** Statuses that mean the food pipeline is still working; anything else is terminal. */
const NON_TERMINAL = new Set(['PENDING', 'UNRESOLVED']);

/** How many complete recipes the report keeps as worked examples. */
const MAX_EXAMPLES = 3;

/** Gap between settle sweeps. */
const POLL_INTERVAL_MS = 2000;

/** Options for {@link runImport}. */
export interface RunImportOptions {
    /** The registry entry for the book being imported. */
    readonly book: Cookbook;
    /** The book's plain text, as the operator downloaded it. */
    readonly plainText: string;
    /** The recipe API client, authenticated as the curator. */
    readonly client: RecipeApiClient;
    /** The idempotency ledger. */
    readonly ledger: ImportLedger;
    /** Stop after creating this many recipes. */
    readonly limit: number;
    /** How long to keep re-reading non-terminal ingredient statuses, in milliseconds. */
    readonly settleMs: number;
    /** Where progress is written. */
    readonly log: (message: string) => void;
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

    /** Food-backed ingredient rows to re-read once the creates are done. */
    const pending = new Map<string, Ingredient>();

    for (const block of blocks) {
        if (report.imported >= limit) {
            break;
        }

        const outcome = toCandidateRecipe(block, book.attribution);

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
            // ⛔ The name goes to the service EXACTLY as the prose gave it. See `resolveIngredient.ts`.
            const resolution = await resolveIngredientLikeAUser(client, parsed.name);

            report.ingredientLines += 1;
            report.resolutionKinds[resolution.kind] += 1;

            if (resolution.catalogAvailability !== 'ok') {
                report.catalogUnavailable += 1;
            }

            const { ingredient } = resolution;

            if (ingredient.foodId !== undefined) {
                report.foodBacked += 1;
                pending.set(ingredient.id, ingredient);
            }

            lines.push({
                ingredientId: ingredient.id,
                // The wire requires a name; the server overwrites it from the catalog row anyway. Sending
                // the catalog's own name keeps the request honest about what it is referencing.
                name: ingredient.name,
                quantity: parsed.quantity ?? 0,
                ...(parsed.unit === null ? {} : { unit: parsed.unit }),
                // The source's own words for this line, kept verbatim beside the structured values.
                notes: parsed.raw,
            });

            exampleLines.push({
                quantity: parsed.quantity ?? 0,
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
    client: RecipeApiClient;
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
