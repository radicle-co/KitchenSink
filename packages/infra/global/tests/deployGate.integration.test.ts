/**
 * Integration suite for the ensure-exists deploy gate's IMPURE half — `deploy-gate.sh evaluate`
 * (issue #124). `deployGate.test.ts` covers the pure decision; this covers everything the decision
 * cannot see: the CloudFormation lookup, the HTTP probe and its retry loop, and the `$GITHUB_OUTPUT`
 * contract the workflow reads the verdict through.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the script (executed as `bash`, not re-implemented), a real child process, a real
 *   `node:http` server on a real socket, real `curl`, real DNS/TCP failure for the unreachable case, and
 *   a real `$GITHUB_OUTPUT` file on disk. The health probe is therefore genuinely exercised end to end.
 * - **Stubbed**: the AWS CLI, via a `aws` executable placed first on `PATH`. CloudFormation itself cannot
 *   be stood up in a unit-tier run, and this seam is exactly where the script talks to it: the stub proves
 *   the script parses `describe-stacks` output, and proves the load-bearing failure translation (a
 *   non-zero `aws` → the `ABSENT` status → deploy).
 *
 * These live in `__tests__/` beside the package's other suites because `@kitchensink/infra-global` has a
 * single test tier (`vitest run` over `__tests__/**`) and this spec needs no external service — a
 * Docker-gated tier would add a config for nothing.
 *
 * ⚠️  The child process is spawned ASYNCHRONOUSLY on purpose. `spawnSync` blocks this process's event loop,
 * so the stub HTTP server below could never answer the child's `curl` — every probe would time out and
 * report `000`, and the suite would "pass" the unreachable cases for entirely the wrong reason.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/deploy-gate.sh', import.meta.url));

/**
 * A stub `aws` binary: prints the status in `AWS_STUB_STATUS`, or exits non-zero (as the real CLI does for
 * a stack that does not exist) when it is `FAIL`.
 */
const AWS_STUB = `#!/usr/bin/env bash
if [ "\${AWS_STUB_STATUS}" = 'FAIL' ]; then
  echo "An error occurred (ValidationError): Stack with id X does not exist" >&2
  exit 254
fi
echo "\${AWS_STUB_STATUS}"
`;

interface EvaluateResult {
    readonly status: number;
    readonly stdout: string;
    readonly output: string;
}

let workdir: string;
let binDir: string;
let server: Server;
let port = 0;
/** Status the stub HTTP server answers `/health` with; mutated per test. */
let healthStatus = 200;
/** A port nothing listens on, for the genuine transport-failure case. */
let deadPort = 0;

beforeAll(async () => {
    workdir = mkdtempSync(join(tmpdir(), 'deploy-gate-'));
    // A directory holding ONLY the stub, prepended to PATH, so the real AWS CLI (if installed) is shadowed
    // and the test cannot accidentally reach a real account.
    binDir = join(workdir, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'aws'), AWS_STUB);
    chmodSync(join(binDir, 'aws'), 0o755);

    server = createServer((_request, response) => {
        // `connection: close` so no keep-alive socket outlives the request and holds `server.close()` open.
        response.writeHead(healthStatus, { 'content-type': 'application/json', connection: 'close' });
        response.end(JSON.stringify({ status: healthStatus === 200 ? 'ok' : 'unavailable' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;

    // Bind a second server only to learn a free port, then release it — a connection to it now fails for
    // real (ECONNREFUSED), which is what curl reports as `000`.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const probeAddress = probe.address();
    deadPort = typeof probeAddress === 'object' && probeAddress !== null ? probeAddress.port : 0;
    await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    server.closeAllConnections();
});

/**
 * Run the real `evaluate` subcommand with the stub `aws` first on PATH and a fresh `$GITHUB_OUTPUT`.
 *
 * @param options - Stub CloudFormation status, whether the sources changed/were forced, and the health URL.
 * @returns Exit status, stdout, and the contents of the `$GITHUB_OUTPUT` file.
 * @sideEffect Spawns `bash`, performs HTTP requests, writes to a temp directory.
 */
const evaluate = async (options: {
    readonly awsStatus: string;
    readonly intent?: string;
    readonly changed?: string;
    readonly forced?: string;
    readonly url: string;
    readonly stacks?: readonly string[];
}): Promise<EvaluateResult> => {
    const outputFile = join(workdir, `output-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(outputFile, '');

    const child = spawn(
        'bash',
        [
            SCRIPT,
            'evaluate',
            options.intent ?? 'true',
            'food',
            options.changed ?? 'false',
            options.forced ?? 'false',
            options.url,
            'us-east-1',
            ...(options.stacks ?? ['kitchensink-food-service-pr-73']),
        ],
        {
            env: {
                ...process.env,
                PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
                AWS_STUB_STATUS: options.awsStatus,
                GITHUB_OUTPUT: outputFile,
                // Drive the REAL retry loop (every attempt) without sleeping five seconds between them.
                DEPLOY_GATE_PROBE_ATTEMPTS: '2',
                DEPLOY_GATE_PROBE_DELAY_SECONDS: '0',
            },
        },
    );

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
    });
    child.stderr.resume();

    const status = await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
    });

    return { status, stdout, output: readFileSync(outputFile, 'utf8') };
};

const healthUrl = (): string => `http://127.0.0.1:${port}/health`;

describe('deploy-gate.sh evaluate — the gate is wired to the real CloudFormation + HTTP boundaries', () => {
    it('is present where the workflows invoke it from', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    it('asks CloudFormation for the named stack in the named region', async () => {
        healthStatus = 200;
        const result = await evaluate({ awsStatus: 'UPDATE_COMPLETE', url: healthUrl() });

        expect(result.stdout).toContain('kitchensink-food-service-pr-73 → UPDATE_COMPLETE');
        expect(result.status).toBe(0);
    });

    // THE issue-#124 path: a docs-only PR changed nothing, and `describe-stacks` fails because the stack
    // has never been created. A failed lookup MUST read as ABSENT (deploy), never as "fine, skip".
    it('translates a failing describe-stacks into ABSENT and deploys (fresh PR, nothing changed)', async () => {
        healthStatus = 200;
        const result = await evaluate({ awsStatus: 'FAIL', url: healthUrl() });

        expect(result.output).toContain('deploy=true');
        expect(result.output).toMatch(/reason=.*ABSENT/);
        expect(result.status).toBe(0);
    });

    it('skips when the stack is usable and the origin really answers 200', async () => {
        healthStatus = 200;
        const result = await evaluate({ awsStatus: 'CREATE_COMPLETE', url: healthUrl() });

        expect(result.output).toContain('deploy=false');
        expect(result.output).toMatch(/reason=.*unchanged/i);
    });

    it('deploys when the origin answers a real non-200 (a live but unhealthy service)', async () => {
        healthStatus = 503;
        const result = await evaluate({ awsStatus: 'UPDATE_COMPLETE', url: healthUrl() });

        expect(result.stdout).toContain('→ 503');
        expect(result.output).toContain('deploy=true');
        expect(result.output).toMatch(/reason=.*503/);
    });

    // A genuine transport failure against a port nothing listens on — the shape a `food-pr-{N}` host that
    // does not exist takes. curl reports 000, and 000 must never look healthy.
    it('deploys when nothing is listening at the origin at all (real ECONNREFUSED → 000)', async () => {
        const result = await evaluate({ awsStatus: 'UPDATE_COMPLETE', url: `http://127.0.0.1:${deadPort}/health` });

        expect(result.stdout).toContain('→ 000');
        expect(result.output).toContain('deploy=true');
        expect(result.output).toMatch(/reason=.*did not answer/i);
    });

    it('deploys a changed service, and still records the live state it observed', async () => {
        healthStatus = 200;
        const result = await evaluate({ awsStatus: 'UPDATE_COMPLETE', changed: 'true', url: healthUrl() });

        expect(result.output).toContain('deploy=true');
        expect(result.output).toMatch(/reason=.*changed/i);
        // The probes run unconditionally so the log always shows what the decision was made against.
        expect(result.stdout).toContain('→ UPDATE_COMPLETE');
        expect(result.stdout).toContain('→ 200');
    });

    it('deploys on a manual dispatch even when everything is already serving', async () => {
        healthStatus = 200;
        const result = await evaluate({ awsStatus: 'UPDATE_COMPLETE', forced: 'true', url: healthUrl() });

        expect(result.output).toContain('deploy=true');
        expect(result.output).toMatch(/reason=.*dispatch/i);
    });

    it('checks EVERY stack it is given (the recipe job owns workers + service)', async () => {
        healthStatus = 200;
        const result = await evaluate({
            awsStatus: 'UPDATE_COMPLETE',
            url: healthUrl(),
            stacks: ['kitchensink-recipe-workers-pr-73', 'kitchensink-recipe-service-pr-73'],
        });

        expect(result.stdout).toContain('kitchensink-recipe-workers-pr-73 → UPDATE_COMPLETE');
        expect(result.stdout).toContain('kitchensink-recipe-service-pr-73 → UPDATE_COMPLETE');
        expect(result.output).toContain('deploy=false');
    });

    // Misuse must not publish a verdict at all: an empty `deploy=` output makes the workflow step's
    // `== 'true'` comparison false, which would silently SKIP the deploy on a broken invocation.
    it('exits 2 and writes NO verdict when invoked with too few arguments', () => {
        const outputFile = join(workdir, 'misuse.txt');
        writeFileSync(outputFile, '');
        const result = spawnSync('bash', [SCRIPT, 'evaluate', 'true', 'food', 'false'], {
            encoding: 'utf8',
            env: { ...process.env, GITHUB_OUTPUT: outputFile },
        });

        expect(result.status).toBe(2);
        expect(readFileSync(outputFile, 'utf8')).toBe('');
    });

    it('exits 2 and writes NO verdict when the changed flag is not a boolean', async () => {
        healthStatus = 200;
        const result = await evaluate({ awsStatus: 'UPDATE_COMPLETE', changed: 'maybe', url: healthUrl() });

        expect(result.status).toBe(2);
        expect(result.output).toBe('');
    });
});
