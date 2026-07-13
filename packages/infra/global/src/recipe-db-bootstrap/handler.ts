/**
 * Platform bootstrap for the `recipe_app` role + base `kitchensink_recipes` database (feature 001, ADR-0006).
 *
 * Runs as a CDK custom resource on every DataStack deploy, connecting to the shared RDS instance AS THE
 * MASTER user (identity_app, from the instance's credentials secret) — the only principal that can create
 * a role and grant it `rds_iam`. `recipe_app` itself authenticates passwordlessly via RDS IAM auth, so it
 * can never bootstrap itself (it cannot connect until this has run); hence a master-connected step. Mirrors
 * the food-db-bootstrap handler exactly (feature 003).
 *
 * Idempotent: safe to re-run on every deploy. Delete is a deliberate no-op — tearing the DataStack down
 * must NOT drop the shared role/database (per-PR databases are dropped by the recipe migrate lambda).
 *
 * @sideEffect Reads Secrets Manager and executes DDL against PostgreSQL as the master user.
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

const { Pool } = pg;

/** Minimal shape of a CloudFormation custom-resource event (only the fields this handler reads). */
interface CustomResourceEvent {
    readonly RequestType: 'Create' | 'Update' | 'Delete';
    readonly PhysicalResourceId?: string;
}

interface CustomResourceResponse {
    readonly PhysicalResourceId: string;
}

/** The master credentials secret shape (RDS-managed): username/password + connection coordinates. */
interface MasterSecret {
    readonly username: string;
    readonly password: string;
}

const PHYSICAL_ID = 'recipe-db-bootstrap';

function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

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

/**
 * Provision the `recipe_app` role (IAM-auth, no password) and the base recipe database, as master. Every
 * statement is guarded so re-running is a no-op. `CREATE DATABASE` cannot run in a DO block, so the base
 * database is created conditionally from a `pg_database` probe (the name is a fixed platform constant, not
 * user input, so quoting it as an identifier is safe).
 *
 * @sideEffect Executes DDL as the master user.
 */
export async function bootstrap(pool: pg.Pool, recipeDatabaseName: string, isProd: boolean): Promise<void> {
    // 1. The least-privilege login role. LOGIN but NO password — it authenticates via IAM (step 2).
    await pool.query(
        "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recipe_app') THEN CREATE ROLE recipe_app LOGIN; END IF; END $$;",
    );

    // 2. Grant the RDS-managed `rds_iam` role, which switches `recipe_app` to IAM-token authentication.
    //    Idempotent — re-granting an existing membership is a no-op.
    await pool.query('GRANT rds_iam TO recipe_app;');

    // 3. Non-prod (sandbox) `recipe_app` needs CREATEDB so the migrate lambda can create per-PR databases
    //    `kitchensink_recipes_pr_{N}` (ADR-0006). Prod has no previews, so prod's role stays without it.
    if (!isProd) {
        await pool.query('ALTER ROLE recipe_app CREATEDB;');
    }

    // 4. The base database, owned by recipe_app. CREATE DATABASE cannot run in a transaction/DO block.
    const existing = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [recipeDatabaseName]);

    if ((existing.rowCount ?? 0) === 0) {
        await pool.query(`CREATE DATABASE "${recipeDatabaseName}" OWNER recipe_app`);
    }

    await pool.query(`GRANT ALL PRIVILEGES ON DATABASE "${recipeDatabaseName}" TO recipe_app;`);
}

export const handler = async (event: CustomResourceEvent): Promise<CustomResourceResponse> => {
    // Deleting the DataStack must never drop the shared role/database — no-op on Delete.
    if (event.RequestType === 'Delete') {
        return { PhysicalResourceId: event.PhysicalResourceId ?? PHYSICAL_ID };
    }

    const credentials = await readMasterCredentials(requireEnv('DB_SECRET_ARN'));
    const recipeDatabaseName = requireEnv('RECIPE_DATABASE_NAME');
    const isProd = requireEnv('STAGE') === 'prod';

    const port = Number(requireEnv('DB_PORT'));

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid DB_PORT "${process.env['DB_PORT']}" — expected a TCP port (1-65535).`);
    }

    const pool = new Pool({
        user: credentials.username,
        password: credentials.password,
        host: requireEnv('DB_ENDPOINT'),
        port,
        database: 'postgres',
        // The RDS CA is absent from Node's trust store; encrypt without verifying it (in-VPC, known
        // endpoint) — mirrors the food service's connection policy.
        ssl: { rejectUnauthorized: false },
        max: 1,
    });

    try {
        await bootstrap(pool, recipeDatabaseName, isProd);
    } finally {
        await pool.end();
    }

    return { PhysicalResourceId: PHYSICAL_ID };
};
