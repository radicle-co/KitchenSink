// @vitest-environment node
/**
 * Repo-wide guard: **every environment variable `next.config.ts` reads reaches `@commise/web#build` through turbo.**
 *
 * Vercel builds the web app with `turbo run build --filter=@commise/web` (`vercel.json`), and turbo runs in strict env
 * mode: a variable no task declares is removed from the task's environment before `next build` starts. Nothing fails
 * when that happens. `SENTRY_AUTH_TOKEN` was set in Vercel and never declared, so every production build logged "No
 * auth token provided. Will not upload source maps" and shipped stack traces nobody could read.
 *
 * A variable passes when turbo hands it to the task by any route: declared on the task (`env` hashed,
 * `passThroughEnv` unhashed), inferred for Next.js (`NEXT_PUBLIC_*`), or on turbo's built-in pass-through list
 * (`CI`, `VERCEL_*`, `NEXT_*`; `crates/turborepo-env/src/lib.rs`).
 *
 * ⛔ A secret goes in `passThroughEnv`, never `env`: hashed `env` writes the value's hash into the cache key and run
 * summaries, and a token does not change what the build outputs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const NEXT_CONFIG = path.join(repoRoot, 'packages/apps/commise/web/next.config.ts');

/** Variables that turbo passes to every task without a declaration, or infers for a Next.js package. */
const TURBO_BUILT_IN = [/^CI$/, /^VERCEL_/, /^NEXT_/];

/** Variables whose values are credentials: they must reach the build, but never through the hashed `env`. */
const SECRETS = new Set(['SENTRY_AUTH_TOKEN']);

/** The env/passThroughEnv turbo resolves for the web build, read from turbo's own plan rather than the JSONC file. */
function webBuildDeclared(): { readonly env: readonly string[]; readonly passThroughEnv: readonly string[] } {
    const stdout = execFileSync(
        path.join(repoRoot, 'node_modules/.bin/turbo'),
        ['run', 'build', '--filter=@commise/web', '--dry=json'],
        { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const plan = JSON.parse(stdout) as {
        readonly tasks: readonly {
            readonly taskId: string;
            readonly environmentVariables: {
                readonly specified: { readonly env: string[] | null; readonly passThroughEnv: string[] | null };
            };
        }[];
    };
    const task = plan.tasks.find((candidate) => candidate.taskId === '@commise/web#build');

    if (task === undefined) {
        throw new Error('turbo planned no @commise/web#build');
    }

    const { env, passThroughEnv } = task.environmentVariables.specified;

    return { env: env ?? [], passThroughEnv: passThroughEnv ?? [] };
}

/** Every `process.env['NAME']` that `next.config.ts` reads. */
function nextConfigReads(): readonly string[] {
    const source = readFileSync(NEXT_CONFIG, 'utf8');

    return [...new Set([...source.matchAll(/process\.env\['([A-Za-z0-9_]+)'\]/g)].map((match) => match[1] ?? ''))];
}

describe('the web build sees every variable next.config.ts reads', () => {
    const declared = webBuildDeclared();
    const reads = nextConfigReads();

    it('finds variables to check (the guard is not vacuously passing)', () => {
        expect(reads).toContain('SENTRY_AUTH_TOKEN');
    });

    it('declares or inherits each one, so strict env mode does not drop it', () => {
        const dropped = reads.filter(
            (name) =>
                !declared.env.includes(name) &&
                !declared.passThroughEnv.includes(name) &&
                !TURBO_BUILT_IN.some((pattern) => pattern.test(name)),
        );

        expect(dropped, 'declare these on @commise/web#build in turbo.json').toEqual([]);
    });

    it('passes each secret through unhashed, never in the hashed env', () => {
        for (const secret of SECRETS) {
            expect(declared.env).not.toContain(secret);
            expect(declared.passThroughEnv).toContain(secret);
        }
    });
});
