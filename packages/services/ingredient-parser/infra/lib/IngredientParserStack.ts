/**
 * The CRF ingredient-parse engine as a deployed function — the repository's FIRST non-Node deployable.
 *
 * A named exception to ADR-0017's "no new deployable service" default, on the three grounds ADR-0019 §3
 * uses: the workload is CPU-shaped and bursty rather than request-shaped, it carries a vendor dependency
 * (a ~94 MB Python CRF with native wheels, a CRF model and a downloaded tagger corpus) the recipe service
 * should not link, and it scales on a different axis from recipe CRUD. ADR-0019 also fixes the consequence, which this stack honours literally: **the new
 * deployable owns no database.** The parse cache lives in the recipe database. See ADR-0025.
 *
 * DESIGN PATTERN: an **Adapter** in front of a third-party engine, deployed as a stateless function. It
 * holds no state, reaches nothing, and grants nothing — its entire IAM surface is the execution role's log
 * writes.
 *
 * ## ⛔ NOT VPC-attached, and that is a decision, not an omission
 *
 * ADR-0004: every VPC-attached Lambda egresses through one `t4g.nano` NAT instance, and the ADR's consumer
 * table is asserted in BOTH directions by `natEgressConsumers.test.ts` — attach this and the ADR must be
 * amended in the same change. There is nothing to attach it FOR: no database, no private endpoint, no
 * egress at all at run time (the engine AND the NLTK tagger corpus it loads are packaged into the asset, so
 * it makes no network call).
 *
 * ⚠️ That last clause was FALSE until 2026-09-05. The corpus was not packaged, so the engine reached for
 * `nltk.download()` at import — a run-time network call this function had neither egress nor a writable
 * filesystem for. It failed on the read-only filesystem before it could fail on the network. The fix is the
 * `NLTK_DATA` environment variable below plus the staging that fills it; see ADR-0025's update.
 *
 * ## Packaging — zip, no `esbuild.mjs`, and a synth-time refusal
 *
 * `infra/bin/buildAsset.ts` stages the asset — pip for the engine, nltk for the tagger corpus — and
 * `Code.fromAsset` publishes it through S3 (so the
 * 50 MB direct-upload limit does not bind; the 250 MB unzipped limit does, and the asset is ~94 MB).
 * Because this service carries no `esbuild.mjs`, W2 of `serviceInfraWiringInvariants.test.ts` SKIPS it —
 * honestly, per its own docstring, but that leaves the hole `handle-sync-worker` fell through. So the
 * staging directory is verified HERE, at synth, before it can be zipped: `Code.fromAsset` throws on a
 * missing directory but happily ships an EMPTY one, and an empty asset deploys green and dies on the first
 * cold start. The full per-file check runs inside the build script (`infra/lib/assetContents.ts`).
 */
import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { existsSync, readdirSync } from 'node:fs';

import { PYTHON_LAMBDA_RUNTIME } from '@kitchensink/infra-security';

import { HANDLER, LAMBDA_ARCHITECTURE, NLTK_DATA_PATH } from './packaging.js';

export interface IngredientParserStackProps extends StackProps {
    /** Deploy stage — `prod` or an ephemeral `pr-{N}`. Drives naming only; this stack imports nothing. */
    readonly stage: string;
    /**
     * The staged Lambda asset directory, produced by `npm run bundle:lambda`.
     *
     * A PROP rather than a path computed inside the stack, so the synth-time refusal below can be fired at
     * a real directory, an empty one and a missing one from the test suite.
     */
    readonly assetDirectory: string;
}

/**
 * Fail the synth when the asset was never staged.
 *
 * @param directory - The staging directory.
 * @sideEffect Reads the filesystem.
 * @throws When the directory is absent or empty — naming the command that produces it, because the reader
 *   of this failure is whoever forgot to run it.
 */
function requireStagedAsset(directory: string): void {
    if (!existsSync(directory)) {
        throw new Error(
            `IngredientParserStack: the Lambda asset has not been staged at '${directory}'. Run ` +
                '`npm run bundle:lambda --workspace=packages/services/ingredient-parser` first (`infra:synth` ' +
                'and `infra:deploy` already do).',
        );
    }

    if (readdirSync(directory).length === 0) {
        throw new Error(
            `IngredientParserStack: the Lambda asset staged at '${directory}' is empty. Code.fromAsset would ` +
                'publish an empty archive and the function would fail on its first cold start — the exact ' +
                'shape of the handle-sync-worker outage. Re-run `npm run bundle:lambda`.',
        );
    }
}

/** The CRF ingredient-parse engine, deployed. */
export class IngredientParserStack extends Stack {
    /** The deployed engine, exposed so a caller's stack can grant itself invoke rights. */
    public readonly parserFunction: lambda.Function;

    public constructor(scope: Construct, id: string, props: IngredientParserStackProps) {
        super(scope, id, props);

        requireStagedAsset(props.assetDirectory);

        const logGroup = new logs.LogGroup(this, 'IngredientParserLogGroup', {
            logGroupName: `/aws/lambda/kitchensink-ingredient-parser-${props.stage}`,
            retention: logs.RetentionDays.TWO_WEEKS,
        });

        // ── IAM: one least-privilege role, granting exactly one thing (ARCH-IT-7) ─────────────────
        //
        // ⛔ NOT CDK's default execution role. That attaches the AWS-managed `AWSLambdaBasicExecutionRole`,
        // which carries `logs:CreateLogGroup` on `*` — a grant this function has no use for, since its log
        // group is created above by CloudFormation — and reports `AwsSolutions-IAM4`, a finding no other
        // Lambda in this repository produces. `logGroup.grantWrite` is the whole permission set: two log
        // actions, scoped to this function's own group. There is nothing else to grant: no database, no
        // bucket, no queue, no VPC (so not even `AWSLambdaVPCAccessExecutionRole`), and — deliberately —
        // no `bedrock:*`, which `llmSpendGuards.test.ts` asserts belongs to exactly one role elsewhere.
        const role = new iam.Role(this, 'IngredientParserRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Executes the CRF ingredient parser. Writes its own logs; reaches nothing else.',
        });

        logGroup.grantWrite(role);

        this.parserFunction = new lambda.Function(this, 'IngredientParserFunction', {
            role,
            functionName: `kitchensink-ingredient-parser-${props.stage}`,
            // ⛔ The ONE Python pin, never a literal. Its ceiling is the engine's own `Requires-Python`;
            // see `@kitchensink/infra-security`'s pythonLambdaRuntime.ts for why that is not CDK's newest.
            runtime: PYTHON_LAMBDA_RUNTIME,
            // ⛔ The SAME constant the build script derives its pip `--platform` from. Declaring ARM here
            // and building x86 wheels there produces an asset that installs cleanly and raises ImportError
            // on the first cold start, so the two are one fact in `packaging.ts`, asserted by its suite.
            architecture: LAMBDA_ARCHITECTURE,
            handler: HANDLER,
            code: lambda.Code.fromAsset(props.assetDirectory),
            // The CRF model is loaded at import: ~1.6 MB of model plus numpy, so a cold start is seconds,
            // not milliseconds. Memory buys proportional CPU on Lambda, and CPU is what this workload is.
            memorySize: 1_024,
            // A full batch is 200 lines; the measured corpus run was well under a millisecond per line
            // AFTER the model is warm, so this is dominated by the cold start it must survive.
            timeout: Duration.seconds(60),
            logGroup,
            environment: {
                // Python buffers stdout by default, which loses the last log lines when a function is frozen
                // mid-write. Nothing about the parse depends on this; the diagnosis of a failed parse does.
                PYTHONUNBUFFERED: '1',
                // ⛔ NOT optional, and not a tuning knob. The engine's `_utils.py` calls
                // `download_nltk_resources()` at import; without this, `nltk.data.find` misses (nothing on
                // nltk's default search path exists on Lambda), the engine calls `nltk.download()`, and the
                // write to `$HOME` raises `OSError: [Errno 30] Read-only file system`. That is exactly how
                // the first real deploy of this function failed. `buildAsset.ts` stages the corpus at the
                // other end of this same constant, and the packaging guard refuses an asset without it.
                NLTK_DATA: NLTK_DATA_PATH,
            },
        });
    }
}
