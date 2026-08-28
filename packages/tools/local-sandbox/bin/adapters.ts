/**
 * @module adapters — the impure half: reading the workspace and running CDK.
 *
 * The pure decisions live in `src/`; everything that touches the filesystem or spawns a process is here,
 * the same split `.github/scripts/deploy-gate.sh` uses (pure `decide`, impure `evaluate`).
 */
import { spawn } from 'node:child_process';
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
