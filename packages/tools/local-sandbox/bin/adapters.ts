/**
 * @module adapters — the impure half: reading the workspace and running CDK.
 *
 * The pure decisions live in `src/`; everything that touches the filesystem or spawns a process is here,
 * the same split `.github/scripts/deploy-gate.sh` uses (pure `decide`, impure `evaluate`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';

import type { PackageManifest } from '../src/discoverApps.js';
import { inferSynthEnv } from '../src/synthEnv.js';
import type { SynthRequest, SynthResult } from '../src/synthesize.js';

/** Repo root, resolved from this file rather than the caller's cwd. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/**
 * Every workspace manifest.
 *
 * ⚠️ `.worktrees/**` is excluded deliberately: this repo keeps sibling checkouts of other features there,
 * and synthesising THEIR CDK would report infrastructure that does not exist on this branch.
 *
 * @returns One entry per readable `package.json`. @sideEffect Reads the filesystem.
 */
export function readManifests(): readonly PackageManifest[] {
    return globSync('packages/**/package.json', {
        cwd: REPO_ROOT,
        ignore: ['**/node_modules/**', '**/dist/**', '.worktrees/**'],
    })
        .sort()
        .flatMap((file) => {
            try {
                return [
                    { dir: path.dirname(file), json: JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8')) },
                ];
            } catch {
                return [];
            }
        });
}

/**
 * The placeholder environment ONE app needs, derived from that app's own source.
 *
 * ⛔ NOT a shared constant. A hardcoded list got three of eight apps to synthesise and then failed one
 * variable at a time — `RECIPE_VPC_ID`, then `RECIPE_LAMBDA_SG_ID` — each fix a hand edit outside the CDK,
 * which is precisely the maintenance this package exists to remove. The keys come from the app's own
 * `process.env['…']` / `requireEnv('…')` reads and the values from their names.
 *
 * @param app - The app to build an environment for.
 * @returns Key/value placeholders. @sideEffect Reads the app's source files.
 */
export function synthEnvFor(app: { readonly packageDir: string }): Readonly<Record<string, string>> {
    const sources = globSync(['infra/**/*.ts', 'bin/**/*.ts', 'lib/**/*.ts'], {
        cwd: path.join(REPO_ROOT, app.packageDir),
        ignore: ['**/node_modules/**', '**/dist/**', '**/__tests__/**'],
    }).flatMap((file) => {
        try {
            return [readFileSync(path.join(REPO_ROOT, app.packageDir, file), 'utf8')];
        } catch {
            return [];
        }
    });

    // ⚠️ STAGE=`dev`, not `local`. `WebhooksStack` VALIDATES the stage against the set this repo deploys
    // (dev, staging, prod, test, sandbox, sandbox-*, mr-*, pr-*) and throws on anything else — `local`
    // failed that app outright. `dev` is the one name every validator here accepts, and a local sandbox is
    // a development environment. It is supplied unconditionally because several apps read STAGE from CDK
    // context with an env fallback, so a source scan alone does not always see it.
    // STAGE last, so it WINS over the value the name-shape rules would infer.
    return { ...inferSynthEnv(sources), STAGE: 'dev' };
}

/**
 * Run one app's synthesis, by invoking THE PACKAGE'S OWN synth script.
 *
 * ⛔ The script, not a reconstructed `cdk synth` command. Reconstructing it drops whatever the script does
 * FIRST, and in this repo that is load-bearing: `@commise/web`'s `infra:synth` is
 * `npm run router:bundle && cdk synth …`, and without the bundle the stack throws `ENOENT … router.cff.js`
 * at synth time. A hand-built command had that app failing for a reason that was entirely self-inflicted.
 * `@kitchensink/food-service` and others likewise prefix `npm run bundle:lambda`.
 *
 * ⚠️ `-- --output <dir>` appends to the script's LAST command, which is the `cdk synth` in every case here.
 * That is how the output lands somewhere this tool controls instead of each package's own `cdk.out` — which
 * is what made the predecessor read three stale templates and report a repo with no database.
 *
 * @param request - Which app, and where to write.
 * @returns Exit code, the templates that appeared, and stderr.
 * @sideEffect Spawns npm (which spawns CDK) and writes to `request.outDir`.
 */
export async function runCdkSynth(request: SynthRequest): Promise<SynthResult> {
    const { app, outDir } = request;
    const args = ['run', app.script, `--workspace=${app.packageName}`, '--', '--output', outDir];

    const { code, stderr } = await new Promise<{ code: number; stderr: string }>((resolve) => {
        const child = spawn('npm', args, {
            cwd: REPO_ROOT,
            env: { ...process.env, ...synthEnvFor(app) },
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let captured = '';

        child.stderr.on('data', (chunk: Buffer) => {
            captured += chunk.toString();
        });
        child.on('close', (exitCode) => resolve({ code: exitCode ?? 1, stderr: captured }));
        child.on('error', (error) => resolve({ code: 1, stderr: String(error) }));
    });

    // Read what actually landed rather than trusting the exit code — the two disagree by design (a failed
    // context lookup exits non-zero and still writes every template).
    const templates = existsSync(outDir)
        ? readdirSync(outDir)
              .filter((file) => file.endsWith('.template.json'))
              .map((file) => path.join(outDir, file))
              .sort()
        : [];

    return { exitCode: code, templates, stderr };
}

/**
 * The port a service listens on locally, taken from its OWN env schema default.
 *
 * ⛔ Read, not allocated. Every container binds 3000 in the deployed world and is separated by host-based
 * ALB routing, so the template cannot answer this. The repo already does: identity defaults to 3001, food
 * to 3002, recipe to 3000 — and `.env.development`'s cross-service URLs already agree with those numbers.
 * An allocation invented here would be a second, competing convention that the committed env files would
 * immediately contradict.
 *
 * @param packageDir - Repo-relative package directory.
 * @returns The default port, or `undefined` when the package does not state one.
 * @sideEffect Reads the package's source.
 */
export function localPortFor(packageDir: string): number | undefined {
    const sources = globSync('src/**/*.ts', {
        cwd: path.join(REPO_ROOT, packageDir),
        ignore: ['**/node_modules/**', '**/__tests__/**'],
    });

    for (const file of sources) {
        let text: string;

        try {
            text = readFileSync(path.join(REPO_ROOT, packageDir, file), 'utf8');
        } catch {
            continue;
        }

        const matched = /\bPORT:[^\n]*?\.default\((\d{2,5})\)/u.exec(text);

        if (matched?.[1] !== undefined) {
            return Number(matched[1]);
        }
    }

    return undefined;
}

/**
 * Build one service image exactly as CI does.
 *
 * ⛔ `docker:prepare` FIRST, and the REPO ROOT as context. The Dockerfiles COPY `dist`, `node_modules` and
 * `prod.package.json` — they are not self-contained multi-stage builds — and `docker:prepare` is what writes
 * that manifest. The context must be the root because they COPY `packages/shared/…/dist` paths that exist
 * only from there; using the service directory fails with "not found" against a path that plainly exists.
 *
 * @param build - What to build.
 * @returns Whether it succeeded, and the output when it did not.
 * @sideEffect Spawns npm and docker.
 */
export function buildServiceImage(build: {
    readonly packageName: string;
    readonly dockerfile: string;
    readonly localImage: string;
}): { readonly ok: boolean; readonly output: string } {
    const steps: readonly (readonly [string, readonly string[]])[] = [
        ['npm', ['run', 'build', `--workspace=${build.packageName}`]],
        ['npm', ['run', 'docker:prepare', `--workspace=${build.packageName}`]],
        ['docker', ['build', '-f', build.dockerfile, '-t', build.localImage, '.']],
    ];

    for (const [command, args] of steps) {
        const result = spawnSync(command, [...args], { cwd: REPO_ROOT, encoding: 'utf8' });

        if (result.status !== 0) {
            return { ok: false, output: `${command} ${args.join(' ')}\n${result.stderr ?? ''}${result.stdout ?? ''}` };
        }
    }

    return { ok: true, output: '' };
}

/**
 * Read one secret out of AWS Secrets Manager.
 *
 * ⛔ THE SAME MOVE CI MAKES. `.github/actions/load-secrets/action.yml` runs
 * `aws secretsmanager get-secret-value --secret-id … --query SecretString`, and so does this — deliberately
 * the CLI rather than an SDK client, so a local run resolves a secret exactly as the pipeline does, with the
 * caller's ambient credentials and no new dependency in a tools package.
 *
 * ⚠️ A JSON secret is a JSON DOCUMENT whose keys ECS selects with the ARN's `:key::` suffix. Reading a key
 * out of a secret that is a plain string would silently yield `undefined`, so the shape is checked rather
 * than assumed.
 *
 * @param secretId - The secret's name.
 * @param jsonKey - A key inside a JSON secret, or `undefined` for the whole string.
 * @returns The value, or `undefined` if the secret or key cannot be read.
 * @sideEffect Spawns the AWS CLI; requires credentials.
 */
export function fetchSecret(secretId: string, jsonKey: string | undefined): string | undefined {
    const result = spawnSync(
        'aws',
        ['secretsmanager', 'get-secret-value', '--secret-id', secretId, '--query', 'SecretString', '--output', 'text'],
        { encoding: 'utf8' },
    );

    if (result.status !== 0) {
        return undefined;
    }

    const raw = (result.stdout ?? '').trim();

    if (raw === '') {
        return undefined;
    }

    if (jsonKey === undefined) {
        return raw;
    }

    try {
        const parsed: unknown = JSON.parse(raw);
        const value = (parsed as Record<string, unknown>)[jsonKey];

        return typeof value === 'string' ? value : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Read one SSM parameter.
 *
 * ⚠️ `--with-decryption` is always passed: a `SecureString` answers with ciphertext without it, and handing a
 * container an encrypted blob is worse than handing it nothing, because the value is PRESENT and wrong. It
 * is a no-op for a plain `String`.
 *
 * @param parameterPath - The full parameter path.
 * @returns The value, or `undefined` when the parameter does not exist (a stage that was never deployed).
 * @sideEffect Spawns the AWS CLI; requires credentials.
 */
export function fetchSsmParameter(parameterPath: string): string | undefined {
    const result = spawnSync(
        'aws',
        [
            'ssm',
            'get-parameter',
            '--name',
            parameterPath,
            '--with-decryption',
            '--query',
            'Parameter.Value',
            '--output',
            'text',
        ],
        { encoding: 'utf8' },
    );

    if (result.status !== 0) {
        return undefined;
    }

    const raw = (result.stdout ?? '').trim();

    return raw === '' ? undefined : raw;
}
