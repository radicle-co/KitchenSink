/**
 * @module db-bootstrap/handler — the ONE custom-resource handler that brings each database on the shared instance
 * into the role split's shape (`docs/plans/2026-09-11-database-role-split.md`).
 *
 * `DataStack` declares three custom resources on this one function — identity, then food, then recipe, serialized
 * so no two passes race on the role catalog — and each names its `service` and `database`. The function connects as
 * the RDS master, the only principal that can create roles and grant `rds_iam`, and runs {@link runBootstrapPass}.
 *
 * `Delete` is a no-op: tearing the stack down must never drop a role or a database.
 *
 * DESIGN PATTERN: Adapter — CloudFormation's custom-resource protocol and Secrets Manager on the outside, the
 * port-driven {@link runBootstrapPass} on the inside; {@link parseBootstrapRequest} is its pure boundary parser.
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

import {
    DATABASE_ROLES,
    RDS_MASTER_USERNAME,
    type DatabaseRoles,
    type DatabaseService,
} from '@kitchensink/db-schema-guard';

import { runBootstrapPass, type MasterConnection } from './bootstrapPass.js';
import { legacyRecreateArmed } from './disposition.js';

/** The fields of a custom-resource event this handler reads. */
interface CustomResourceEvent {
    readonly RequestType: 'Create' | 'Update' | 'Delete';
    readonly PhysicalResourceId?: string;
    readonly ResourceProperties: Readonly<Record<string, unknown>>;
}

interface CustomResourceResponse {
    readonly PhysicalResourceId: string;
}

/** A validated request. */
export interface BootstrapRequest {
    readonly service: DatabaseService;
    readonly roles: DatabaseRoles;
    readonly database: string;
    readonly isProd: boolean;
    readonly armed: boolean;
}

/** A database name that is safe to quote into DDL. */
const SAFE_DATABASE_NAME = /^[a-z0-9_]+$/u;

const isService = (value: unknown): value is DatabaseService =>
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(DATABASE_ROLES, value);

/**
 * Validate the custom resource's properties and the function's environment.
 *
 * @param properties - `ResourceProperties`: `service`, `database`, and — only on an armed stage — `legacyRecreate`.
 * @param env - Reads `STAGE` and, on an armed stage, `LEGACY_RECREATE_ARMED`.
 * @returns The request. Pure.
 * @throws {Error} on an unknown service, an unsafe database name, a missing `STAGE`, or a mis-wired arming token.
 */
export function parseBootstrapRequest(
    properties: Readonly<Record<string, unknown>>,
    env: Readonly<Record<string, string | undefined>>,
): BootstrapRequest {
    const stage = env['STAGE'];

    if (!stage) {
        throw new Error('db-bootstrap: STAGE is not set — refusing to guess whether this is prod.');
    }

    const { service, database, legacyRecreate } = properties;

    if (!isService(service)) {
        throw new Error(`db-bootstrap: unknown service ${JSON.stringify(service)}.`);
    }

    if (typeof database !== 'string' || !SAFE_DATABASE_NAME.test(database)) {
        throw new Error(`db-bootstrap: refusing database name ${JSON.stringify(database)}.`);
    }

    // TWO PLACES, ONE SOURCE — and the distinction matters, because the stronger reading is false. Both the
    // event property and the function's environment are written from the SAME `LEGACY_RECREATE_ARMED_STAGES`
    // constant in `DataStack.ts`, so this is not two independent judgements agreeing; a wrong entry in that
    // list arms both halves at once and neither can catch it.
    //
    // What the pairing DOES buy is resistance to a hand-crafted invoke, which is the threat it was built for:
    // the token is a public string and `lambda:Invoke` in this shared account is not the authority, so an
    // event claiming to be armed is refused unless a DataStack DEPLOY of an armed stage also set the
    // function's flag. That property holds exactly as written below — it is only the word "independent" that
    // claimed more than the code does, and a comment that overstates a safety property is worse than none.
    const eventArmed = legacyRecreateArmed(typeof legacyRecreate === 'string' ? legacyRecreate : undefined, stage);
    const functionArmed = legacyRecreateArmed(env['LEGACY_RECREATE_ARMED'], stage);

    if (eventArmed && !functionArmed) {
        throw new Error(
            'db-bootstrap: refusing an armed legacy-recreate request — this deployed function is not armed ' +
                '(no LEGACY_RECREATE_ARMED in its environment).',
        );
    }

    return {
        service,
        roles: DATABASE_ROLES[service],
        database,
        isProd: stage === 'prod',
        armed: eventArmed && functionArmed,
    };
}

function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`db-bootstrap: missing required environment variable ${name}.`);
    }

    return value;
}

/** Read the master credentials; refuse unless they are the master the role model is built around. */
async function readMasterPassword(secretArn: string): Promise<string> {
    const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretArn }));
    const parsed = JSON.parse(response.SecretString ?? '{}') as { username?: unknown; password?: unknown };

    if (parsed.username !== RDS_MASTER_USERNAME || typeof parsed.password !== 'string' || parsed.password === '') {
        throw new Error(
            `db-bootstrap: the master secret must hold ${RDS_MASTER_USERNAME} and a password; it holds ` +
                `${JSON.stringify(parsed.username)}.`,
        );
    }

    return parsed.password;
}

/**
 * The custom-resource entry point.
 *
 * @param event - The CloudFormation event.
 * @returns The stable physical id `db-bootstrap-<service>`.
 * @sideEffect Reads Secrets Manager; creates roles, memberships and databases as the RDS master; on an armed stage,
 *   drops a legacy base database.
 */
export const handler = async (event: CustomResourceEvent): Promise<CustomResourceResponse> => {
    if (event.RequestType === 'Delete') {
        return { PhysicalResourceId: event.PhysicalResourceId ?? 'db-bootstrap' };
    }

    const request = parseBootstrapRequest(event.ResourceProperties, process.env);
    const password = await readMasterPassword(requireEnv('DB_SECRET_ARN'));
    const host = requireEnv('DB_ENDPOINT');
    const port = Number(requireEnv('DB_PORT'));

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`db-bootstrap: invalid DB_PORT ${JSON.stringify(process.env['DB_PORT'])}.`);
    }

    const connectAsMaster = async (database: string): Promise<MasterConnection> => {
        // The RDS CA is not in Node's trust store; encrypt without verifying it (in-VPC, known endpoint).
        const client = new pg.Client({
            user: RDS_MASTER_USERNAME,
            password,
            host,
            port,
            database,
            ssl: { rejectUnauthorized: false },
        });

        await client.connect();

        return client;
    };

    const session = await connectAsMaster('postgres');

    try {
        const report = await runBootstrapPass(
            { session, connectAsMaster, log: (entry) => console.log(JSON.stringify(entry)) },
            { ...request, master: RDS_MASTER_USERNAME },
        );

        console.log(JSON.stringify({ message: 'database bootstrap complete', ...report }));
    } finally {
        await session.end();
    }

    return { PhysicalResourceId: `db-bootstrap-${request.service}` };
};
