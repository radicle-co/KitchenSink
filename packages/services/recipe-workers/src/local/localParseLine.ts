/**
 * @module localParseLine — the parse leg's LOCAL wiring: the same handler, different collaborators.
 *
 * DESIGN PATTERN: **Composition Root.** `processParseLine` already takes everything injected (the
 * `verifyLine.ts` discipline), so a local run needs no new pipeline, no new orchestration and no edit to the
 * handler — only a second construction of {@link ParseLineDeps}. That is the whole point of this file:
 * `parseLine.ts`'s own `productionDeps` builds the deployed set (RDS-IAM pool, `LambdaClient`, real
 * Bedrock, SSM settings); this builds the local one, and everything between the two is shared code.
 *
 * ## What is REAL locally, and what is not
 *
 * | Collaborator      | Locally                                        | Parity                                    |
 * | ----------------- | ---------------------------------------------- | ----------------------------------------- |
 * | pipeline + merge  | the shipped `runParsePipeline`                  | identical                                 |
 * | corrections/cache | the shipped ports over real PostgreSQL          | identical — the SQL is the SQL            |
 * | landing + digest  | the shipped `processParseLine`                  | identical, including R17's zero-row discard |
 * | CRF engine        | the DEPLOYED `handler.py`, run as a subprocess  | same contract, different transport        |
 * | LLM               | an offline substitute at `ConverseTransport`    | everything above the wire is shipped code |
 * | spend ledger      | the shipped ledger over the local database      | constructed, and ungated at a local stage |
 *
 * ⛔ The ONE thing a local run cannot claim is parse QUALITY, because that is the model's and there is no
 * model. `localSupport.ts` already records Bedrock as unsupported for exactly this reason; nothing here
 * weakens that statement.
 *
 * ⛔ Nothing in this module may be reached from a deployed bundle. `localWiringIsNotDeployed.test.ts`
 * asserts that by walking the imports of `esbuild.mjs`'s own entry points.
 */
import { createHash } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { createBedrockConverseClient } from '@kitchensink/bedrock-client';
import { parseLineJobMessageSchema } from '@kitchensink/recipe-core/parsing/parse-job-message';

import { createCrfInvokeEngine } from '../parsing/crfInvoke.js';
import { createSpendLedger } from '../common/verificationSpend.js';
import { emitMetric } from '../common/metrics.js';
import { PARSE_LEG_MODEL_ID, processParseLine, type ParseLineDeps } from '../handlers/parseLine.js';

import { createLocalBedrockTransport, LOCAL_ONLY_STAGES } from './localBedrockTransport.js';
import { createLocalCrfLambdaClient, createPythonEngineRunner, pinnedCrfEngineVersion } from './localCrfEngine.js';

/**
 * The ceiling a local run reports.
 *
 * ⚠️ INERT, and named so a reader does not go looking for a policy here. `isSpendGated` is true for the
 * production stage alone (ADR-0024: sandbox and every `pr-{N}` call ungated), so the ledger is never
 * consulted at a local stage. The number is the ADR's own $100 rather than something enormous, so that a
 * reader who does find it is not told a different policy than the one in force.
 */
export const LOCAL_INERT_CEILING_MICROS = 100_000_000;

/** Everything the local entry needs from its environment. */
export interface LocalParseLineConfig {
    readonly stage: string;
    /** A `postgres://` URL for the LOCAL recipe database — never the RDS-IAM path `common/db.ts` builds. */
    readonly databaseUrl: string;
    readonly queueUrl: string;
    /** LocalStack's endpoint. Required: without it the SDK would address real AWS with a localhost URL. */
    readonly sqsEndpoint: string;
    readonly region: string;
    /** The interpreter the CRF engine runs under. */
    readonly python: string;
}

/** Raised when the local entry's environment is incomplete. */
export class LocalParseLineConfigError extends Error {
    public constructor(missing: readonly string[]) {
        super(
            `the local parse worker needs ${missing.join(', ')}. ` +
                'Run `npm run local:up` first, then `npm run dev --workspace=@kitchensink/recipe-workers`.',
        );
        this.name = 'LocalParseLineConfigError';
        Object.setPrototypeOf(this, LocalParseLineConfigError.prototype);
    }
}

/** Type guard for {@link LocalParseLineConfigError}. */
export function isLocalParseLineConfigError(error: unknown): error is LocalParseLineConfigError {
    return error instanceof LocalParseLineConfigError;
}

/**
 * Read the local entry's configuration.
 *
 * ⛔ `DATABASE_URL`, `RECIPE_PARSE_QUEUE_URL` and `SQS_ENDPOINT` have NO defaults, for the reason
 * `RECIPE_DB_NAME` has none in `common/db.ts` (#119): which database a worker mutates and which queue it
 * drains are not values with a sensible fallback. A default endpoint in particular would let a
 * misconfigured run address real AWS.
 *
 * ⚠️ `STAGE` DOES default, to the stage `local-sandbox/bin/adapters.ts` synthesises at — and the offline
 * Bedrock substitute refuses any non-local stage, so a `STAGE=prod` in the shell is a refusal rather than a
 * silent switch to real inference.
 *
 * @param env - The process environment.
 * @returns The configuration. Pure.
 * @throws {LocalParseLineConfigError} naming every missing variable at once.
 */
export function readLocalParseLineConfig(env: NodeJS.ProcessEnv): LocalParseLineConfig {
    const required = {
        DATABASE_URL: env['DATABASE_URL'],
        RECIPE_PARSE_QUEUE_URL: env['RECIPE_PARSE_QUEUE_URL'],
        SQS_ENDPOINT: env['SQS_ENDPOINT'],
    };
    const missing = Object.entries(required).flatMap(([name, value]) => (value === undefined ? [name] : []));

    if (missing.length > 0) {
        throw new LocalParseLineConfigError(missing);
    }

    return {
        // The default is the first LOCAL stage rather than a literal, so it cannot drift away from the set
        // the offline Bedrock substitute accepts.
        stage: env['STAGE'] ?? LOCAL_ONLY_STAGES[0],
        databaseUrl: required.DATABASE_URL as string,
        queueUrl: required.RECIPE_PARSE_QUEUE_URL as string,
        sqsEndpoint: required.SQS_ENDPOINT as string,
        region: env['AWS_REGION'] ?? 'us-east-1',
        python: env['LOCAL_CRF_PYTHON'] ?? 'python3',
    };
}

/**
 * Build the parse handler's collaborators for a local run.
 *
 * @param config - The local configuration.
 * @param pool - A pg pool on the local recipe database, owned by the caller.
 * @returns The same {@link ParseLineDeps} the deployed handler receives.
 * @throws When the stage is not local (the Bedrock substitute refuses) or the engine pin is unreadable.
 * @sideEffect Constructs the ledger over the pool; the CRF port spawns a process per call.
 */
export function createLocalParseLineDeps(config: LocalParseLineConfig, pool: Pool): ParseLineDeps {
    return {
        stage: config.stage,
        gated: {
            stage: config.stage,
            // ⚠️ A static resolver, not `createSsmSettingsLoader`. The settings are OPERATOR configuration
            // and locally the operator is the developer; more to the point, `gatedConverse` reads only
            // `ceilingMicros` from here (every leg passes its own `modelId`), and the ceiling is inert at an
            // ungated stage. A LocalStack SSM read would add a failure mode that proves nothing.
            settings: {
                resolve: async () => ({ ceilingMicros: LOCAL_INERT_CEILING_MICROS, modelId: PARSE_LEG_MODEL_ID }),
            },
            ledger: createSpendLedger(drizzle(pool)),
            // ⛔ The REAL client over a fake transport — see localBedrockTransport.ts on why the seam is here.
            bedrock: createBedrockConverseClient(createLocalBedrockTransport({ stage: config.stage })),
            emit: emitMetric,
            now: () => new Date(),
        },
        crf: createCrfInvokeEngine({
            // Diagnostic only: the local transport never addresses a function by name. Named for the logs.
            functionName: `local-ingredient-parser-${config.stage}`,
            client: createLocalCrfLambdaClient(createPythonEngineRunner({ python: config.python })),
            declaredEngineVersion: pinnedCrfEngineVersion(),
            // The availability signal is wired locally for the same reason the gated leg's is: a local run
            // that skipped it would exercise a different `crfInvoke` path than the deployed one, and this
            // module exists to run the SHIPPED code. `emitMetric` writes EMF-shaped JSON to stdout here —
            // no CloudWatch, no AWS call — so a local engine failure is visible exactly where a deployed
            // one would be.
            stage: config.stage,
            emit: emitMetric,
        }),
        pool: { query: async (text, params) => pool.query(text, params) },
        digest: (value) => createHash('sha256').update(value).digest('hex'),
        parseModelId: PARSE_LEG_MODEL_ID,
    };
}

/**
 * Handle one raw SQS body, exactly as the deployed `handler` does.
 *
 * ⚠️ The schema is the SHARED `parseLineJobMessageSchema`, not a local reading of the body. A message shape
 * this consumer accepted and the deployed one refused would be the worst kind of local-only success.
 *
 * @param deps - The local collaborators.
 * @param body - The message body, verbatim.
 * @sideEffect Everything `processParseLine` does.
 */
export async function handleLocalParseMessage(deps: ParseLineDeps, body: string): Promise<void> {
    await processParseLine(deps, parseLineJobMessageSchema.parse(JSON.parse(body)));
}
