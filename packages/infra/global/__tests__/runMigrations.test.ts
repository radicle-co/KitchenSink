/**
 * Repo-wide guard: the schema-migration SAFETY NET (`.github/scripts/run-migrations.sh`).
 *
 * ## The failure this pins — prod was the WEAKER stage
 *
 * ADR-0022 moved the schema apply INSIDE the deploy, as an `aws-cdk-lib/triggers` Trigger every Lambda and
 * ECS service in the stack is ordered behind. The pipeline's own `aws lambda invoke` was kept as a stated
 * SAFETY NET, "because it is idempotent and catches a stage whose schema is behind for a reason no code
 * change explains: a restore, a stage created later, a `deploy_webhooks`-only run" (§4).
 *
 * That net was gated on the same path-diff flag as the deploy it follows. So in the one case it exists for —
 * a stage whose schema is behind for a reason NO CODE CHANGE EXPLAINS — the flag is `false`: no `cdk deploy`
 * runs, the in-stack Trigger never fires, the invoke is skipped, and the deploy reports success against an
 * unmigrated database. The net covered exactly the runs that did not need it.
 *
 * ⚠️ Sandbox never had this hole: ADR-0010's ensure-exists gate forces a deploy when the stack is absent or
 * the origin is not serving, so the Trigger fires there without a code change. Prod's gate is pure path-diff
 * and has no such probe, which made PRODUCTION the weaker stage — the inverse of what anybody would assume.
 *
 * Running unconditionally is safe, and that is a property of the runner rather than an optimism:
 * `schema_migrations` is keyed by FILENAME (`name TEXT PRIMARY KEY`, no checksum) and the runner skips on a
 * name match, so a run against an up-to-date database applies nothing and costs one Lambda invocation.
 *
 * ## The second defect, same class
 *
 * `aws lambda invoke` exits 0 when the FUNCTION threw — the failure is in the response, not the exit status.
 * `sandbox-deploy.yml`'s food invoke inspected neither `FunctionError` nor the payload, so a migration runner
 * that threw left the step green and the deploy continued onto a schema that had not moved. Its recipe
 * sibling grepped for `errorType` and its identity sibling read `FunctionError` — three call sites, three
 * different amounts of rigour. This script is the ONE definition, so there is nothing left to drift.
 *
 * ## Why the predicates are executed as real `bash`
 *
 * Same reason as `deployGate.test.ts` and `prScope.test.ts`: a TypeScript re-implementation would be a
 * second copy of the decision, free to drift from the one CI runs. `classify` is PURE — a `FunctionError`
 * and a payload in, a verdict out — and every AWS call lives in `run`, covered by
 * `tests/runMigrations.integration.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/run-migrations.sh', import.meta.url));

/** One classification, as the script prints it. */
interface Verdict {
    readonly verdict: string;
    readonly reason: string;
    readonly status: number;
}

/**
 * Run the pure `classify` subcommand.
 *
 * @param functionError - What `aws lambda invoke --query FunctionError` printed (`None` when it threw not).
 * @param payload - The response payload, as written to disk.
 * @returns The parsed verdict plus the exit status.
 * @sideEffect Spawns `bash`.
 */
function classify(functionError: string, payload: string): Verdict {
    const result = spawnSync('bash', [SCRIPT, 'classify', functionError, payload], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const stdout = result.stdout ?? '';

    return {
        verdict: /^verdict=(.*)$/m.exec(stdout)?.[1] ?? '',
        reason: /^reason=(.*)$/m.exec(stdout)?.[1] ?? '',
        status: result.status ?? -1,
    };
}

describe('run-migrations.sh exists and refuses misuse', () => {
    it('is present at the path the workflows call', () => {
        expect(existsSync(SCRIPT), `${SCRIPT} is missing — every deploy workflow invokes it`).toBe(true);
    });

    it('exits 2 on an unknown subcommand, never 0', () => {
        expect(spawnSync('bash', [SCRIPT, 'nonsense'], { encoding: 'utf8' }).status).toBe(2);
    });

    it('exits 2 when `run` is not told which stack and output to use', () => {
        expect(spawnSync('bash', [SCRIPT, 'run', 'us-east-1'], { encoding: 'utf8' }).status).toBe(2);
    });
});

describe('classify — `aws lambda invoke` exits 0 when the FUNCTION threw', () => {
    it('accepts a clean run', () => {
        expect(classify('None', '{"applied":["0001_init.sql"],"pending":[]}').verdict).toBe('ok');
    });

    it('accepts a run that applied nothing — the idempotent case that makes unconditional safe', () => {
        // `schema_migrations` is keyed by filename and the runner skips on a name match, so "nothing to do"
        // is the NORMAL outcome of the safety net and must never read as a failure.
        expect(classify('None', '{"applied":[],"pending":[]}').verdict).toBe('ok');
    });

    it('⛔ FAILS on a FunctionError, which the CLI reports with exit status 0', () => {
        const { verdict, reason } = classify('Unhandled', '{"errorType":"Error","errorMessage":"connect ETIMEDOUT"}');

        expect(verdict).toBe('failed');
        expect(reason).toMatch(/FunctionError/);
    });

    it('⛔ FAILS on an errorType in the payload even when FunctionError says None', () => {
        // The half `sandbox-deploy.yml`'s recipe leg caught and its food leg did not. A handled throw can
        // leave `FunctionError` unset while the payload carries the fault.
        const { verdict, reason } = classify('None', '{"errorType":"MigrationError","errorMessage":"boom"}');

        expect(verdict).toBe('failed');
        expect(reason).toMatch(/errorType/);
    });

    it('⛔ FAILS on an EMPTY payload — nothing came back, so nothing was proved', () => {
        const { verdict, reason } = classify('None', '');

        expect(verdict).toBe('failed');
        expect(reason).toMatch(/no payload/i);
    });

    it('treats a literal `null` payload as a clean run, not as an absent one', () => {
        // A handler that returns nothing writes `null`. That is a runner design choice, not a fault, and
        // conflating it with "the invoke produced nothing" would red every deploy of such a runner.
        expect(classify('None', 'null').verdict).toBe('ok');
    });

    it('rejects a missing argument as misuse rather than classifying it', () => {
        expect(spawnSync('bash', [SCRIPT, 'classify', 'None'], { encoding: 'utf8' }).status).toBe(2);
    });
});
