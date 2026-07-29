/**
 * @module scripts/buildWithEndpoints — the web app's `build` entry point.
 *
 * Runs `next build` with a PR preview's own backend endpoints resolved from configuration and layered over
 * the inherited environment. Outside a Vercel preview build it resolves nothing and is a transparent
 * pass-through, so a local `npm run build`, CI's build job, and the production pipeline are all unaffected.
 *
 * ## Why the build goes through a wrapper at all
 *
 * `NEXT_PUBLIC_*` is inlined by the bundler, so the backend a preview talks to is frozen in at build time.
 * Vercel environment variables are scoped to an ENVIRONMENT, not a deployment, so a single project-wide
 * `NEXT_PUBLIC_RECIPE_API_URL` cannot express "this PR's own recipe service" — see `previewEndpoints.ts` for
 * the full account of what that shipped.
 *
 * The tempting fix — write `.env.production.local` and let Next load it — is unsound: `process.env` beats
 * every `.env` file, so a leftover project-scoped value would silently win and the bug would survive its own
 * fix. Spawning the build with the resolved values on top is the only layering that cannot lose.
 *
 * @sideEffect Reads `process.env`, writes to stdout, spawns `next build`, and exits the process.
 */
import { spawn } from 'node:child_process';

import { resolveBuildEndpoints } from './previewEndpoints';

const endpoints = resolveBuildEndpoints(process.env);

for (const [key, value] of Object.entries(endpoints)) {
    const inherited = process.env[key];

    // A DIFFERING inherited value is the failure this wrapper exists for: it means a project-scoped variable
    // is still set and was about to be compiled into a preview built for a different PR. Say so out loud —
    // the override makes the build correct, but the stale variable should be deleted from the dashboard.
    if (inherited !== undefined && inherited !== value) {
        console.warn(
            `[build] ${key}: overriding inherited '${inherited}' with '${value}' resolved for this preview. ` +
                'The inherited value is project-scoped and therefore wrong for every PR but one — remove it.',
        );
    } else {
        console.log(`[build] ${key}=${value} (resolved for this preview)`);
    }
}

const child = spawn('next', ['build', ...process.argv.slice(2)], {
    env: { ...process.env, ...endpoints },
    stdio: 'inherit',
    shell: false,
});

child.on('error', (err) => {
    console.error(`[build] failed to start next build: ${err.message}`);
    process.exit(1);
});

// Mirror the child's outcome exactly: turbo and Vercel both key off this process's exit status, and a signal
// death (an OOM-killed build is the common one) must not be reported as success.
child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
});
