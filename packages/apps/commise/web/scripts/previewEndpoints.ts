/**
 * @module scripts/previewEndpoints — resolve a PR preview build's backend endpoints from configuration.
 *
 * Every PR deploys its OWN recipe service (`kitchensink-recipe-service-pr-{N}` → `recipe-pr-{N}.commise.app`);
 * identity is the one shared, persistent sandbox deployable every preview signs in against. So a preview
 * build's endpoints are per-deployment values, and `NEXT_PUBLIC_*` is inlined by the bundler at BUILD time —
 * which makes "which backend did this bundle get compiled against" a build-time decision with no runtime
 * recovery.
 *
 * ## The defect this exists to close
 *
 * Vercel environment variables are scoped to an ENVIRONMENT (Preview / Production), not to a deployment. The
 * pr-73 preview embeds the right host only because that literal was typed by hand into the project's Preview
 * environment, so every other PR would have been built against **PR 73's** recipe service: live, healthy, and
 * completely unrelated. Nothing errors — the wrong data simply appears — and the moment PR 73 closes and its
 * stack is torn down, every preview breaks at once with no obvious cause.
 *
 * ## The shape (why a template, and why not derive the hostname)
 *
 * Configuration supplies the whole URL with a `{pr}` placeholder:
 *
 *   | variable                                        | example                                |
 *   | ----------------------------------------------- | -------------------------------------- |
 *   | `NEXT_PUBLIC_RECIPE_API_URL_SANDBOX_TEMPLATE`   | `https://recipe-pr-{pr}.commise.app`   |
 *   | `NEXT_PUBLIC_IDENTITY_API_URL_SANDBOX_TEMPLATE` | `https://identity.sandbox.commise.app` |
 *
 * `SANDBOX` is in the name because it is in the VALUE: both templates describe sandbox topology — a per-PR
 * recipe service, and the single shared sandbox identity host every preview signs in against. Production
 * cannot reuse either one (the recipe template needs a PR number production does not have, and the identity
 * template would point production at the sandbox instance and its dev-instance Clerk keys), so a name that
 * did not say `SANDBOX` invited exactly that reading. Production sets the plain `NEXT_PUBLIC_*` names
 * directly; see `.env.template`.
 *
 * The per-PR host SHAPE already has exactly one owner — `recipeSubdomainForStage` in the recipe service's
 * CDK. Re-deriving `recipe-pr-${pr}.commise.app` here would copy that knowledge across a package boundary
 * with nothing to keep the two in step, so this module only substitutes. The shape stays in configuration,
 * which is where the endpoint-config directive put it, and the app learns no hostnames.
 *
 * ## Why this OVERRIDES rather than writing a dotenv file
 *
 * The obvious alternative — write `.env.production.local` and let Next load it — cannot be made correct:
 * `process.env` beats every `.env` file, so a leftover project-scoped `NEXT_PUBLIC_RECIPE_API_URL` would
 * silently win and reintroduce the exact bug. The caller (`buildWithEndpoints.ts`) therefore spawns the real
 * build with these values layered ON TOP of the inherited environment.
 *
 * ## Why there is no fallback
 *
 * A preview build that cannot determine its PR number throws. `src/config/env.ts` has no defaults for the
 * same reason: guessing is what compiled `http://localhost:3000` into a shipped bundle.
 */

/**
 * Where the PR number may come from, in PRECEDENCE order.
 *
 * `PREVIEW_PR_NUMBER` is injected per-deployment by CI (`vercel deploy --build-env`) and wins, because CI
 * knows the number for certain. `VERCEL_GIT_PULL_REQUEST_ID` is Vercel's own, populated only for a
 * deployment it can associate with an OPEN pull request — which a branch's FIRST deployment never is, since
 * the push necessarily precedes `gh pr create`.
 */
const PR_NUMBER_SOURCES = ['PREVIEW_PR_NUMBER', 'VERCEL_GIT_PULL_REQUEST_ID'] as const;

/** The `{pr}` placeholder a per-PR endpoint template must carry. */
const PR_PLACEHOLDER = '{pr}';

/**
 * The endpoints resolvable from a preview template, and whether that endpoint is deployed PER PR.
 *
 * `perPr` is the topology rule made checkable: recipe is deployed per PR, so a fixed recipe template can
 * only be some other PR's service or a persistent instance that must not exist. Identity is deliberately
 * NOT per-PR — demanding `{pr}` there would demand a per-PR identity service, the one thing that must never
 * be created or torn down.
 */
const ENDPOINTS = [
    { key: 'NEXT_PUBLIC_RECIPE_API_URL', perPr: true },
    { key: 'NEXT_PUBLIC_IDENTITY_API_URL', perPr: false },
] as const;

/** A process environment as read by this module: names to values, any of which may be absent. */
export type BuildEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Substitute the PR number into an endpoint template. A template with no placeholder is returned unchanged.
 * Pure.
 *
 * @param template - The configured endpoint template.
 * @param prNumber - The pull-request number to substitute.
 * @returns The template with every `{pr}` replaced.
 */
export function substitutePrNumber(template: string, prNumber: string): string {
    return template.split(PR_PLACEHOLDER).join(prNumber);
}

/**
 * Read the pull-request number a Vercel preview build belongs to.
 *
 * @param environment - The build environment.
 * @returns The PR number as a string.
 * @throws If it is absent or not a plain number — a preview with no known PR has no per-PR backend, and the
 *   value is substituted straight into a hostname, so anything else is a typo or an injection attempt.
 */
function requirePrNumber(environment: BuildEnvironment): string {
    for (const name of PR_NUMBER_SOURCES) {
        const raw = environment[name]?.trim() ?? '';

        if (raw === '') {
            continue;
        }

        // A source that is SET but malformed is a misconfiguration, not a reason to try the next one:
        // falling through would build this preview against a different PR's backend, silently.
        if (!/^\d+$/.test(raw)) {
            throw new Error(
                `${name} must be the pull request number, but was '${raw}'. It is substituted straight into ` +
                    'a hostname, so anything else is a typo or an injection attempt.',
            );
        }

        return raw;
    }

    throw new Error(
        `No pull request number: none of ${PR_NUMBER_SOURCES.join(', ')} is set. A preview build that does ` +
            'not belong to a PR has no per-PR backend to talk to — every PR deploys its own recipe service, ' +
            'so there is no shared non-prod instance to fall back to. Note that Vercel leaves ' +
            'VERCEL_GIT_PULL_REQUEST_ID EMPTY for a deployment created by a branch push before that ' +
            'branch has an open PR, which is unavoidable (the push precedes the PR). CI therefore deploys ' +
            'the preview itself on `pull_request: opened` and injects PREVIEW_PR_NUMBER explicitly — see ' +
            'the "Deploy this PR\'s Vercel preview" step in .github/workflows/sandbox-web-preview.yml.',
    );
}

/**
 * Resolve the endpoint variables a Vercel PREVIEW build must be compiled with, from the `*_SANDBOX_TEMPLATE`
 * variables and the build's PR number. Pure.
 *
 * Returns an empty object for any build that is not a Vercel preview (production, `vercel dev`, CI's build
 * job, a developer's `npm run build`) — those take their endpoints from their own environment and must not
 * be rewritten from a preview template.
 *
 * An endpoint whose template is unset (or blank) is OMITTED rather than rejected: a caller may legitimately
 * supply one endpoint by template and the other directly, and `src/config/env.ts` is the single place that
 * decides an endpoint is missing.
 *
 * @param environment - The build environment to read.
 * @returns The variables to layer over the build environment; empty outside a preview build.
 * @throws If this is a preview build with no usable PR number, or a template is malformed — resolved here,
 *   where the message can name the `*_SANDBOX_TEMPLATE` variable an operator has to fix, rather than the derived
 *   variable they never set.
 */
export function resolveBuildEndpoints(environment: BuildEnvironment): Readonly<Record<string, string>> {
    if (environment['VERCEL_ENV'] !== 'preview') {
        return {};
    }

    const templates = ENDPOINTS.map(({ key, perPr }) => ({
        key,
        perPr,
        name: `${key}_SANDBOX_TEMPLATE`,
        template: environment[`${key}_SANDBOX_TEMPLATE`]?.trim() ?? '',
    })).filter(({ template }) => template !== '');

    // Nothing configured to resolve, so nothing to demand. Checking this BEFORE the PR number matters twice:
    // it keeps this module inert until the `*_SANDBOX_TEMPLATE` variables are actually set (so adding it broke no
    // existing preview), and Vercel only sets `VERCEL_GIT_PULL_REQUEST_ID` for a deployment that belongs to a
    // PR — a plain branch deployment has none, and must not be failed for a template it was never given.
    if (templates.length === 0) {
        return {};
    }

    const prNumber = requirePrNumber(environment);
    const resolved: Record<string, string> = {};

    for (const { key, perPr, name, template } of templates) {
        if (perPr && !template.includes(PR_PLACEHOLDER)) {
            throw new Error(
                `${name} must contain '${PR_PLACEHOLDER}' but was '${template}'. That service is deployed ` +
                    "PER PR, so a fixed host is either another PR's deployment or a persistent instance that " +
                    'does not exist — and it would not fail loudly, because the sandbox wildcard resolves and ' +
                    "answers the shared ALB's default 404.",
            );
        }

        const value = substitutePrNumber(template, prNumber);

        if (!/^https?:\/\/\S+$/.test(value)) {
            throw new Error(`${name} must resolve to an absolute http(s) URL, but produced '${value}'.`);
        }

        resolved[key] = value;
    }

    return resolved;
}
