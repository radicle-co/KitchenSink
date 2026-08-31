/**
 * `npm run promotions:cli` — the OPERATOR surface over the U12 moderation routes (the plan's launch
 * deliverable; a web admin page is EXPLICITLY DEFERRED so no UI is left unowned).
 *
 * Commands:
 *     pending                          list the moderation queue
 *     approve <promotionId>            phase 1 (food) + phase 2 (recipe mapping), reported separately
 *     reject <promotionId>             decline; the fingerprint bars identical resubmission
 *     phase2 <normalizedName> <foodId> re-run ONLY the recipe-side mapping rewrite (resume after a kill)
 *
 * ## ⛔ The TWO-PHASE shape, spelled out (plan U12; ADR-0006)
 *
 * Phase 1 (food DB, ATOMIC): the approve route elects the canonical and flips it `promoted`.
 * Phase 2 (recipe DB, IDEMPOTENT + RESUMABLE): a curated correction — `POST /api/v1/ingredients/
 * corrections {phrase, foodId, surfacing: 'promotion'}` under the operator's `recipes:mappings:global`
 * grant — binds the name to the canonical through the EXISTING mapping-supersession shape. Re-issuing
 * it is `recorded: false / already in force`, which is why a kill between the phases is recovered by
 * `phase2 …` and never by editing a database. Between the phases every state is safe: the canonical is
 * world-readable, and old loser references still resolve through their authors' own rows.
 *
 * Environment: `FOOD_SERVICE_URL`, `RECIPE_SERVICE_URL`, `OPERATOR_BEARER` (a token holding `food:admin`
 * AND `recipes:mappings:global` in its signed `public_metadata`).
 *
 * @sideEffect Network calls to both services; prints to stdout/stderr; sets the exit code.
 */
import { pathToFileURL } from 'node:url';

/** One parsed CLI invocation. */
interface CliInvocation {
    readonly command: 'pending' | 'approve' | 'reject' | 'phase2';
    readonly args: readonly string[];
}

/** The environment the CLI needs, validated up front so a missing var fails before any call. */
interface CliEnvironment {
    readonly foodUrl: string;
    readonly recipeUrl: string;
    readonly bearer: string;
}

/** Parse argv, or explain usage. Pure. Exported for the unit suite. */
export function parseInvocation(argv: readonly string[]): CliInvocation | undefined {
    const [command, ...args] = argv;

    if (command === 'pending' && args.length === 0) {
        return { command, args };
    }

    if ((command === 'approve' || command === 'reject') && args.length === 1) {
        return { command, args };
    }

    if (command === 'phase2' && args.length === 2) {
        return { command, args };
    }

    return undefined;
}

/** Read and validate the environment. */
function readEnvironment(): CliEnvironment | undefined {
    const foodUrl = process.env['FOOD_SERVICE_URL'];
    const recipeUrl = process.env['RECIPE_SERVICE_URL'];
    const bearer = process.env['OPERATOR_BEARER'];

    if (foodUrl === undefined || recipeUrl === undefined || bearer === undefined) {
        return undefined;
    }

    return { foodUrl, recipeUrl, bearer };
}

/** One authenticated JSON call. @sideEffect Network. */
async function callJson(
    env: CliEnvironment,
    base: 'food' | 'recipe',
    method: string,
    path: string,
    body?: unknown,
): Promise<{ status: number; body: unknown }> {
    const origin = base === 'food' ? env.foodUrl : env.recipeUrl;
    const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${env.bearer}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

/**
 * Phase 2: bind the promoted name to the canonical in the recipe knowledge base. Idempotent — an
 * "already in force" answer is SUCCESS, which is what makes re-running after a kill safe.
 *
 * @sideEffect One recipe-service call.
 */
async function runPhase2(env: CliEnvironment, normalizedName: string, canonicalFoodId: string): Promise<boolean> {
    const result = await callJson(env, 'recipe', 'POST', '/api/v1/ingredients/corrections', {
        phrase: normalizedName,
        foodId: canonicalFoodId,
        surfacing: 'promotion',
    });

    if (result.status !== 200) {
        process.stderr.write(`  phase 2 FAILED (${String(result.status)}): ${JSON.stringify(result.body)}\n`);
        process.stderr.write(
            `  resume with: promotions:cli phase2 ${JSON.stringify(normalizedName)} ${canonicalFoodId}\n`,
        );

        return false;
    }

    const body = result.body as { recorded?: boolean; scope?: string; outcome?: string };

    if (body.recorded === true) {
        process.stdout.write(`  phase 2: mapping recorded (scope ${body.scope ?? '?'}).\n`);
    } else {
        // `recorded: false` here means the binding is ALREADY in force — the idempotent re-run.
        process.stdout.write(`  phase 2: already in force (${body.outcome ?? 'no-op'}).\n`);
    }

    return true;
}

async function main(): Promise<void> {
    const invocation = parseInvocation(process.argv.slice(2));
    const env = readEnvironment();

    if (invocation === undefined) {
        process.stderr.write(
            'usage: promotions:cli pending | approve <id> | reject <id> | phase2 <normalizedName> <foodId>\n',
        );
        process.exitCode = 2;

        return;
    }

    if (env === undefined) {
        process.stderr.write('FOOD_SERVICE_URL, RECIPE_SERVICE_URL and OPERATOR_BEARER must be set.\n');
        process.exitCode = 2;

        return;
    }

    if (invocation.command === 'pending') {
        const result = await callJson(env, 'food', 'GET', '/api/v1/foods/admin/promotions/pending');

        if (result.status !== 200) {
            process.stderr.write(`pending FAILED (${String(result.status)}): ${JSON.stringify(result.body)}\n`);
            process.exitCode = 1;

            return;
        }

        const { pending } = result.body as {
            pending: Array<{ id: string; normalizedName: string; candidateFoodIds: string[]; createdAt: string }>;
        };

        if (pending.length === 0) {
            process.stdout.write('No pending promotions.\n');

            return;
        }

        for (const row of pending) {
            process.stdout.write(
                `${row.id}  ${row.normalizedName}  (${String(row.candidateFoodIds.length)} foods, queued ${row.createdAt})\n`,
            );
        }

        return;
    }

    if (invocation.command === 'phase2') {
        const [name, foodId] = invocation.args;
        const ok = await runPhase2(env, name ?? '', foodId ?? '');

        process.exitCode = ok ? 0 : 1;

        return;
    }

    const [id] = invocation.args;
    const result = await callJson(
        env,
        'food',
        'POST',
        `/api/v1/foods/admin/promotions/${id ?? ''}/${invocation.command}`,
    );

    if (result.status !== 200 && result.status !== 201) {
        process.stderr.write(
            `${invocation.command} FAILED (${String(result.status)}): ${JSON.stringify(result.body)}\n`,
        );
        process.exitCode = 1;

        return;
    }

    if (invocation.command === 'reject') {
        process.stdout.write(`Rejected ${id ?? ''} — identical resubmission is barred by fingerprint.\n`);

        return;
    }

    const approved = result.body as { canonicalFoodId: string; normalizedName: string };

    process.stdout.write(`  phase 1: approved — canonical ${approved.canonicalFoodId} is now world-readable.\n`);

    const ok = await runPhase2(env, approved.normalizedName, approved.canonicalFoodId);

    process.exitCode = ok ? 0 : 1;
}

// Run only when EXECUTED, never on import — the unit suite imports the parser, and an import that fired
// network calls (or set the process exit code) would fail the importer for reading a function.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
