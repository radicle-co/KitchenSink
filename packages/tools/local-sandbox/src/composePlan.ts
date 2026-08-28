/**
 * @module composePlan — the local compose stack, GENERATED from the synthesised CDK.
 *
 * ⛔ REPLACES TWO HAND-MAINTAINED FILES THAT HAD ALREADY DRIFTED. `docker-compose.yml` ran
 * `localstack/localstack:3` with `SERVICES: s3`; `infra/localstack/docker-compose.yml` ran `4.4.0` with
 * everything EXCEPT s3. Both bind 5432 and 4566, so they could not run together — and neither was a
 * superset, so "run everything locally" was not achievable with either.
 *
 * The synthesised CDK says the answer is ten services. Nobody was going to keep that current by hand, which
 * is precisely why it had not been.
 */

/** What `summarizeRequirements` produced, narrowed to what a compose plan reads. */
export interface ComposeInput {
    readonly localstackServices: readonly string[];
    readonly containers: readonly string[];
}

export interface ComposeOptions {
    /** Logical databases the CDK named, each created on first start. */
    readonly databases: readonly string[];
}

/** One container in the generated stack. */
export interface ComposeService {
    readonly image: string;
    readonly ports: readonly string[];
    readonly environment: Readonly<Record<string, string>>;
    readonly healthcheck: Readonly<Record<string, unknown>>;
    readonly volumes?: readonly string[];
}

export interface ComposePlan {
    readonly services: Readonly<Record<string, ComposeService | undefined>>;
    /** `psql` run once on first start, creating every database the CDK named. */
    readonly initSql: string;
}

/**
 * ⚠️ PINNED, not floating. The two files this replaces disagreed (`:3` vs `4.4.0`), which is how two stacks
 * that both "work" stop agreeing about behaviour. `4.4.0` is the version the E2E harness already proved
 * against, so adopting it changes nothing that was passing.
 */
const LOCALSTACK_IMAGE = 'localstack/localstack:4.4.0';

/** Local Postgres credentials. Fixed and known — there is no secret to fetch locally. */
export const LOCAL_DB = Object.freeze({ user: 'postgres', password: 'postgres', bootstrapDatabase: 'postgres' });

/**
 * Build the compose stack a local sandbox needs.
 *
 * @param requirements - Folded from the synthesised templates.
 * @param options - The databases to create.
 * @returns A plan ready to serialise. Pure.
 */
export function planCompose(requirements: ComposeInput, options: ComposeOptions): ComposePlan {
    const services: Record<string, ComposeService | undefined> = {};

    if (requirements.localstackServices.length > 0) {
        services['localstack'] = {
            image: LOCALSTACK_IMAGE,
            ports: ['4566:4566'],
            environment: {
                // Sorted, so a reordered inventory is not a diff.
                SERVICES: [...requirements.localstackServices].sort().join(','),
                DEBUG: '0',
                // Load every declared service at boot, so `--wait` returning means they answer.
                EAGER_SERVICE_LOADING: '1',
            },
            healthcheck: {
                test: ['CMD-SHELL', 'curl -sf http://localhost:4566/_localstack/health | grep -q available'],
                interval: '3s',
                timeout: '3s',
                retries: 30,
            },
        };
    }

    // ⚠️ The image comes from the CDK-derived container list, not a literal here. When the RDS engine pin
    // moves (ADR: PostgreSQL 18 was a one-way door), the local database follows without an edit.
    const postgresImage = requirements.containers.find((image) => image.startsWith('postgres:'));

    if (postgresImage !== undefined) {
        services['postgres'] = {
            image: postgresImage,
            ports: ['5432:5432'],
            environment: {
                POSTGRES_USER: LOCAL_DB.user,
                POSTGRES_PASSWORD: LOCAL_DB.password,
                POSTGRES_DB: LOCAL_DB.bootstrapDatabase,
            },
            healthcheck: {
                test: ['CMD-SHELL', `pg_isready -U ${LOCAL_DB.user}`],
                interval: '3s',
                timeout: '3s',
                retries: 30,
            },
            // ⚠️ `/var/lib/postgresql`, NOT `/var/lib/postgresql/data`. The postgres:18 image moved PGDATA
            // to `/var/lib/postgresql/18/docker` and declares its VOLUME at the parent; on the old path the
            // named volume holds nothing while the real cluster lands in an anonymous one, and local data is
            // silently discarded on every recreate. The same note is on the file this replaces.
            volumes: ['local-sandbox-pgdata:/var/lib/postgresql'],
        };
    }

    return { services, initSql: initSql(options.databases) };
}

/**
 * `CREATE DATABASE` for each name, guarded so a re-run is a no-op.
 *
 * ⚠️ Guarded because the volume survives `docker compose down` without `-v`. An unguarded `CREATE` fails on
 * the second start and takes the whole init script with it, leaving a half-provisioned cluster that looks
 * healthy. `CREATE DATABASE` cannot run inside a DO block, so the guard is a `\\gexec` over a SELECT.
 *
 * @param databases - Names to create.
 * @returns SQL. Pure.
 */
function initSql(databases: readonly string[]): string {
    const statements = [...databases]
        .sort()
        .map(
            (name) =>
                `SELECT 'CREATE DATABASE "${name}"' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${name}')\\gexec`,
        );

    return [
        '-- GENERATED by @kitchensink/local-sandbox from the synthesised CDK. Do not edit.',
        ...statements,
        '',
    ].join('\n');
}
