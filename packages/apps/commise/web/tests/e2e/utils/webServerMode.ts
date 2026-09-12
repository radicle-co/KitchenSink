/**
 * Which server the Playwright suite drives, and the command that starts it.
 *
 * ## Why this is a decision and not a constant
 *
 * Locally the suite must drive `next dev`: a developer runs it against the working tree, with no build,
 * and expects an edit to be picked up. In CI the opposite is true — a build has already happened (the
 * `build` job compiles `@commise/web` and publishes `.next` as an artifact), and the dev server is
 * actively harmful there, because Next compiles a route the FIRST time it is requested and that
 * compilation lands INSIDE the assertion that triggered it.
 *
 * That is not a theory about slowness; it is the measured behaviour of this suite. From one shard's blob
 * report, on specs that do nothing but click a link and read a heading:
 *
 *   18.3s  recipeSourceTabs — /recipes ⇄ /discover round trip
 *   14.4s  recipeOwnerActions — Edit is a real link
 *   10.6s  recipeOwnerActions — Delete confirms
 *
 * The suite therefore ran at its assertion budgets, and on commit 6e40d66a all three attempts of
 * `recipeSourceTabs.spec.ts` failed with `expect(page).toHaveURL(/\/discover/)` still reading
 * `/en/recipes` — a correct link that had simply not finished navigating in 5s. Retries hid most of it,
 * which is precisely why it survived: the report says "flaky", not "the server is compiling".
 *
 * ## The shape of the rule
 *
 * `E2E_WEB_SERVER` is the explicit answer; `CI` is the default. An unrecognised value is an ERROR rather
 * than a fallback, because both fallbacks are bad: falling back to `dev` restores the flake under a
 * config that looks deliberate, and falling back to `start` fails a developer's run with a confusing
 * "could not find a production build".
 *
 * ⚠️ `basePath` is BUILD-TIME (`next.config.ts` derives it from `PREVIEW_BASE_PATH` at build). It follows
 * that `PREVIEW_BASE_PATH` has NO effect on a `start` run — the prefix is already baked into the
 * artifact. CI only ever exercises the bare (subdomain) shape today, so nothing is lost; but if the
 * legacy prefixed preview shape is ever wired into CI, it needs its OWN build, made with
 * `PREVIEW_BASE_PATH` set, and cannot share the bare artifact. See ADR-0001.
 *
 * Every function in this module is pure.
 */

/** The two servers the suite can drive. */
export type WebServerMode = 'dev' | 'start';

/**
 * The `npm run` script that starts each mode's server.
 *
 * ⚠️ `next start` prints `"next start" does not work with "output: standalone" configuration` — this app
 * sets `output: 'standalone'` in `next.config.ts` for a future ECS deploy. The warning is advisory: `next
 * start` serves the very same `.next` directory and the whole suite passes against it (107 passed, 1
 * skipped, 0 failed, locally). It is recorded rather than silenced because the supported alternative is a
 * different command with different inputs — `node .next/standalone/…/server.js`, which additionally needs
 * `.next/static` and `public/` COPIED into the standalone tree (Next does not do it) and would triple the
 * CI artifact. Neither Vercel nor this suite uses the standalone server today, so `next start` is both the
 * simpler and the more representative of the two. If a future Next release turns the warning into an
 * error, that is the migration.
 */
const COMMANDS: Readonly<Record<WebServerMode, string>> = {
    dev: 'npm run dev',
    start: 'npm run start',
};

/** Raised when `E2E_WEB_SERVER` holds something that is not a mode. */
export class InvalidWebServerModeError extends Error {
    public constructor(value: string) {
        super(
            `E2E_WEB_SERVER='${value}' is not a web-server mode. Use 'dev' (next dev — compiles on demand, ` +
                "for local work) or 'start' (next start — serves a production build, what CI runs). Leave it " +
                'unset to take the default for the environment. See tests/e2e/utils/webServerMode.ts.',
        );
        this.name = 'InvalidWebServerModeError';
        Object.setPrototypeOf(this, InvalidWebServerModeError.prototype);
    }
}

/**
 * Type guard for {@link InvalidWebServerModeError}.
 *
 * @param error - Any thrown value.
 * @returns Whether it is an {@link InvalidWebServerModeError}.
 */
export function isInvalidWebServerModeError(error: unknown): error is InvalidWebServerModeError {
    return error instanceof InvalidWebServerModeError;
}

/**
 * Decide which server this run drives.
 *
 * @param env - The process environment to read (`E2E_WEB_SERVER`, `CI`).
 * @returns The selected mode.
 * @throws {InvalidWebServerModeError} When `E2E_WEB_SERVER` is set to anything but a mode.
 */
export function resolveWebServerMode(env: Readonly<Record<string, string | undefined>>): WebServerMode {
    const requested = env['E2E_WEB_SERVER'];

    if (requested !== undefined && requested !== '') {
        if (requested !== 'dev' && requested !== 'start') {
            throw new InvalidWebServerModeError(requested);
        }

        return requested;
    }

    // A declared-but-empty variable is not a signal — GitHub sets `CI=true`.
    return env['CI'] !== undefined && env['CI'] !== '' ? 'start' : 'dev';
}

/**
 * The command that starts the server for a mode.
 *
 * Both go through the package's OWN scripts rather than a bare `next` binary, so the command CI runs is
 * the command a developer can run, and the production path has exactly one spelling.
 *
 * @param mode - The selected mode.
 * @returns The shell command Playwright's `webServer` runs.
 */
export function webServerCommand(mode: WebServerMode): string {
    return COMMANDS[mode];
}
