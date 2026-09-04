/**
 * Reclaim — and COUNT — the per-PR logical databases on the shared non-prod RDS instance (ADR-0031).
 *
 * ## Why this exists when the migration runners already drop
 *
 * ADR-0006 gives every preview its own logical database on the one shared instance, and
 * `teardown-sandbox-pr.sh` used to drop it by invoking that service's own in-VPC migration runner. That door
 * is inside the service's stack, which means it cannot reclaim:
 *
 *  - a database whose stack is **already gone or wedged** (a `DELETE_FAILED` or `UPDATE_ROLLBACK_FAILED`
 *    stack publishes no outputs, and once it is deleted the only thing that could reach the
 *    `PRIVATE_ISOLATED` RDS goes with it); or
 *  - the databases **already stranded** by the period when `RecipeMigrationFunctionName` existed and nothing
 *    ever called it — every reaped recipe preview left `kitchensink_recipes_pr_{N}` behind.
 *
 * This function is owned by `DataStack`, beside the instance itself, so it outlives every service stack.
 *
 * ## ⛔ SANDBOX ONLY, twice over
 *
 * `DataStack` instantiates it only when the stage is not `prod`, and the handler refuses at RUNTIME when
 * `STAGE` is `prod` — belt and braces, because a capability that drops databases with master credentials
 * should not depend on one guard in one file. Prod has no per-PR databases at all (ADR-0006 gives its
 * `food_app`/`recipe_app` roles no `CREATEDB`), so in production this is dead code carrying a live risk.
 * The refusal covers BOTH actions rather than just `drop`: allowing a prod census would leave the drop guard
 * as the only thing standing, and "just enable counting in prod" is exactly how that erodes.
 *
 * ## The census is the point, not a side effect
 *
 * `perPrInventory.ts` reports the same numbers from the `DataStack` bootstrap resources — but those are
 * CloudFormation custom resources, and CloudFormation re-invokes them only when their PROPERTIES change. A
 * sandbox global deploy completed on 2026-09-04 and left both bootstrap Lambdas with no log streams at all,
 * so nobody can currently count the stranded databases. `{"action":"count"}` here is invocable on demand and
 * drops nothing.
 *
 * @sideEffect Reads Secrets Manager, reads `pg_database`, and — in drop mode only — executes `DROP DATABASE`.
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

import { perPrLikePattern } from '../db-bootstrap/perPrInventory.js';
import { PER_PR_DATABASE_BASES, isReapablePerPrDatabase } from './perPrDatabaseScope.js';
import {
    parseReapRequest,
    planReap,
    type PerPrDatabaseCatalogRow,
    type ReapPlan,
    type ReapRequest,
} from './reapPlan.js';

const { Pool } = pg;

/** The master credentials secret shape (RDS-managed). */
interface MasterSecret {
    readonly username: string;
    readonly password: string;
}

/** What one invocation reports back. Identical in both modes except for the two reclamation lists. */
export interface ReapResult {
    /** What was asked for. */
    readonly action: ReapRequest['action'];
    /** The stage this instance serves — echoed so a log line is self-describing. */
    readonly stage: string;
    /** The PR reclaimed, for a drop. */
    readonly pr?: string;
    /** The whole-instance census, on every invocation. */
    readonly census: ReapPlan['census'];
    /** The databases actually dropped, sorted. Always empty for a count. */
    readonly dropped: readonly string[];
    /** Names this PR could own that were not present — "already reclaimed" rather than "failed". */
    readonly absent: readonly string[];
}

/**
 * The one place a database identifier is quoted into SQL.
 *
 * `DROP DATABASE` cannot be parameterised. The name is safe to quote because it reached here only by exact
 * equality with a name `perPrDatabaseNamesFor` derived from a `^pr-[0-9]+$` token and a hard-coded
 * base, so it matches `^[a-z0-9_]+$` — asserted in `perPrDatabaseScope.test.ts` rather than assumed.
 *
 * `IF EXISTS` makes a re-run a no-op (a teardown may run twice, and the daily reaper re-visits tokens);
 * `WITH (FORCE)` terminates the sessions a torn-down preview leaves behind, without which PostgreSQL refuses
 * the drop and the database survives every future sweep.
 *
 * @param databaseName - A name that has passed {@link isReapablePerPrDatabase}.
 * @returns The statement to issue. Pure.
 */
export function reapDropStatement(databaseName: string): string {
    return `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`;
}

/**
 * Read every candidate row from `pg_database`, one narrowing query per registered base.
 *
 * The `LIKE` pattern is a COARSE narrowing, never the authority: the scope predicate decides what belongs to
 * whom. `perPrLikePattern` is reused from the bootstrap census so the `_`-is-a-wildcard escaping — the trap
 * that makes the obvious `${base}_%` match names it has no business claiming — lives in one place.
 *
 * @param pool - A pool connected as the master user.
 * @returns Every row under a per-PR base, de-duplicated by name.
 * @sideEffect Reads `pg_database`.
 */
export async function readPerPrCatalog(pool: pg.Pool): Promise<readonly PerPrDatabaseCatalogRow[]> {
    const byName = new Map<string, PerPrDatabaseCatalogRow>();

    for (const base of PER_PR_DATABASE_BASES) {
        // ESCAPE is stated rather than relied upon: backslash IS the default, but a default is a
        // setting-shaped assumption and this pattern is the whole basis of the read.
        const result = await pool.query<PerPrDatabaseCatalogRow>(
            "SELECT datname, datconnlimit FROM pg_database WHERE datname LIKE $1 ESCAPE '\\'",
            [perPrLikePattern(base)],
        );

        for (const row of result.rows) {
            byName.set(row.datname, row);
        }
    }

    return [...byName.values()];
}

/**
 * Carry out a plan, RE-ASSERTING the scope verdict on every name immediately before it is quoted into SQL.
 *
 * ⛔ The re-assertion is the point of this function, and it is the same belt-and-braces
 * `teardown-sandbox-pr.sh` applies before deleting a GitHub Environment: the predicate already refused
 * everything it should have, so reaching the throw means the predicate itself regressed — which must fail
 * loudly rather than proceed. The whole plan is checked BEFORE the first statement is issued, so a poisoned
 * plan drops nothing at all rather than everything up to the offending entry.
 *
 * @param pool - A pool connected as the master user.
 * @param plan - The plan produced by {@link planReap}.
 * @param request - The parsed request the plan was made for.
 * @returns What was dropped and what was already absent.
 * @throws {Error} when a planned name does not pass the scope predicate.
 * @sideEffect Executes `DROP DATABASE` for every planned name.
 */
export async function executeReap(
    pool: pg.Pool,
    plan: ReapPlan,
    request: ReapRequest,
): Promise<Pick<ReapResult, 'dropped' | 'absent'>> {
    if (request.action === 'count') {
        return { dropped: [], absent: [] };
    }

    for (const databaseName of plan.drop) {
        if (!isReapablePerPrDatabase(request.pr, databaseName)) {
            throw new Error(
                `Refusing to drop "${databaseName}" for ${request.pr} — the scope predicate let it through, ` +
                    'which is a bug in perPrDatabaseScope.ts. Nothing was dropped.',
            );
        }
    }

    for (const databaseName of plan.drop) {
        await pool.query(reapDropStatement(databaseName));
    }

    return { dropped: plan.drop, absent: plan.absent };
}

/** Read a required environment variable, or fail with the name that is missing. */
function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

/** Fetch the RDS master credentials. */
async function readMasterCredentials(secretArn: string): Promise<MasterSecret> {
    const client = new SecretsManagerClient({});
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

    if (!response.SecretString) {
        throw new Error(`Secret ${secretArn} has no SecretString`);
    }

    const parsed = JSON.parse(response.SecretString) as Partial<MasterSecret>;

    if (!parsed.username || !parsed.password) {
        throw new Error(`Secret ${secretArn} missing username/password`);
    }

    return { username: parsed.username, password: parsed.password };
}

export const handler = async (event: unknown): Promise<ReapResult> => {
    const stage = requireEnv('STAGE');

    // ⛔ The second half of "sandbox only". `DataStack` does not create this function at the prod stage, so
    // reaching here on prod means it was deployed by something that did not read ADR-0031 — and a
    // master-credentialed DROP DATABASE in production is not a risk this repository accepts. Both actions
    // are refused, not just `drop`: leaving a prod census reachable would make the drop guard the only thing
    // standing, and it is the guard a later "just let it count in prod" change would erode.
    if (stage === 'prod') {
        throw new Error(
            'The per-PR database reaper refuses to run at the prod stage. Production has no per-PR logical ' +
                'databases (ADR-0006 grants its roles no CREATEDB), so this function is not deployed there ' +
                '— see ADR-0031. Reaching this means something deployed it to prod.',
        );
    }

    const request = parseReapRequest(event);
    const credentials = await readMasterCredentials(requireEnv('DB_SECRET_ARN'));
    const port = Number(requireEnv('DB_PORT'));

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid DB_PORT "${process.env['DB_PORT']}" — expected a TCP port (1-65535).`);
    }

    const pool = new Pool({
        user: credentials.username,
        password: credentials.password,
        host: requireEnv('DB_ENDPOINT'),
        port,
        // The MAINTENANCE database: `DROP DATABASE` cannot run from inside the database being dropped.
        database: 'postgres',
        // The RDS CA is absent from Node's trust store; encrypt without verifying it (in-VPC, known
        // endpoint) — mirrors the bootstrap handlers' connection policy.
        ssl: { rejectUnauthorized: false },
        max: 1,
    });

    try {
        const plan = planReap(await readPerPrCatalog(pool), request);
        const outcome = await executeReap(pool, plan, request);
        const result: ReapResult = {
            action: request.action,
            stage,
            ...(request.action === 'drop' ? { pr: request.pr } : {}),
            census: plan.census,
            ...outcome,
        };

        console.log(JSON.stringify({ message: 'per-PR logical database reap (ADR-0031)', ...result }));

        return result;
    } finally {
        await pool.end();
    }
};
