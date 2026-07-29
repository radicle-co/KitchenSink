/**
 * Which local env files the service reads — and, far more importantly, which stages read NONE (issue #120).
 *
 * This is the recipe service's counterpart of the mechanism `web/.env.development` and
 * `mobile/.env.development` use, and the GATE is the whole point. Endpoints like `FOOD_SERVICE_URL` are
 * REQUIRED with no in-code default, which is what makes a misconfigured deploy fail loudly; a committed env
 * file that deployed stages also read would quietly restore exactly the silent fallback that was removed. So
 * the files are loaded ONLY when `NODE_ENV` is `development` — deployed stages run `staging`/`production` (see
 * `infra/lib/recipe-service-stack.ts`) and therefore read NO file at all, not even a stray `.env` that
 * happened to be baked into the image.
 *
 * `.env.local` is gitignored and wins, so a developer can point at a deployed backend without editing a
 * tracked file.
 *
 * Lives in its own module rather than beside `AppConfigModule` because that module's `@Module` decorator
 * validates `process.env` at IMPORT time — a test importing the file for this pure function would boot the
 * whole config contract.
 */

/**
 * The env files to load for a `NODE_ENV`, in precedence order (first wins).
 *
 * @param nodeEnv - The raw `NODE_ENV` value.
 * @returns The env files to load; EMPTY for anything other than exactly `development`. Pure.
 */
export function localEnvFilePaths(nodeEnv: string | undefined): string[] {
    return nodeEnv === 'development' ? ['.env.local', '.env.development'] : [];
}
