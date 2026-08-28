/**
 * @module localImages — build the service images locally, and point the local stack at them.
 *
 * ⛔ THE CDK NAMES THE REPOSITORY BUT NOT THE BUILD. The stacks use `ContainerImage.fromEcrRepository`, so
 * they reference a prebuilt tag and every asset manifest carries `dockerImages: []`. The other half is
 * stated elsewhere in the repo and is READ, not invented:
 *
 *   WHICH package — the app that synthesised the stack the task definition belongs to.
 *   HOW to prepare — that package's own `docker:prepare`, which CI runs immediately before `docker buildx`
 *                    and which writes the `prod.package.json` the Dockerfile COPYs.
 *   WHERE from     — `-f <package>/Dockerfile` with the REPO ROOT as context, exactly as CI invokes it.
 *
 * ⚠️ The context is the easiest thing to get wrong. These Dockerfiles COPY `packages/shared/…/dist` paths
 * that only exist relative to the repo root; building with the service directory as context fails with a
 * "not found" against a path that plainly exists.
 */
import { inferPlaceholder } from './synthEnv.js';

/** One image to build, and the task definition that wants it. */
export interface ImageBuild {
    readonly stack: string;
    readonly logicalId: string;
    /** ECR repository the CDK referenced, e.g. `kitchensink-food`. */
    readonly repository: string;
    /** The tag built and run locally. */
    readonly localImage: string;
    readonly packageName: string;
    readonly dockerfile: string;
    readonly containerPort: number | undefined;
}

/** `…/kitchensink-food:tag` — the repository segment of an ECR reference, however it is spelled. */
const ECR_REPOSITORY = /\/(kitchensink-[a-z0-9-]+):/u;

/**
 * Pull the repository name out of an image reference.
 *
 * ⚠️ The reference is usually an `Fn::Join` of literals and `Ref`s, so it is matched against the
 * SERIALISED form rather than walked — the repository is always a literal segment either way.
 */
function repositoryOf(image: unknown): string | undefined {
    return ECR_REPOSITORY.exec(JSON.stringify(image) ?? '')?.[1];
}

/**
 * Find the images a stack's task definitions need.
 *
 * @param stack - Stack name.
 * @param template - The synthesised template.
 * @param app - The package that synthesised it, which owns the Dockerfile.
 * @returns One entry per task definition with a resolvable repository, de-duplicated by repository. Pure.
 */
export function discoverImageBuilds(
    stack: string,
    template: unknown,
    app: { readonly packageName: string; readonly packageDir: string },
): readonly ImageBuild[] {
    const resources =
        (template as { Resources?: Record<string, { Type?: unknown; Properties?: unknown }> }).Resources ?? {};
    const seen = new Set<string>();

    return Object.entries(resources).flatMap(([logicalId, resource]) => {
        if (resource.Type !== 'AWS::ECS::TaskDefinition') {
            return [];
        }

        const container = (
            resource.Properties as { ContainerDefinitions?: readonly Record<string, unknown>[] } | undefined
        )?.ContainerDefinitions?.[0];
        const repository = repositoryOf(container?.['Image']);

        // ⚠️ De-duplicated by REPOSITORY, not by task. food declares api, worker and change-refresh on one
        // image; building it three times triples the slowest step in the command for no benefit.
        if (repository === undefined || seen.has(repository)) {
            return [];
        }

        seen.add(repository);

        const ports = container?.['PortMappings'] as readonly { ContainerPort?: unknown }[] | undefined;
        const port = ports?.[0]?.ContainerPort;

        return [
            {
                stack,
                logicalId,
                repository,
                localImage: `local-sandbox/${repository}:local`,
                packageName: app.packageName,
                dockerfile: `${app.packageDir}/Dockerfile`,
                containerPort: typeof port === 'number' ? port : undefined,
            },
        ];
    });
}

/** What a container needs to reach its local siblings. */
export interface LocalEnvContext {
    /** The database this service uses. */
    readonly database: string;
    /** The port it listens on locally. */
    readonly port: number;
    /**
     * Compose service name → the port it listens on, for rewriting sibling URLs.
     *
     * ⚠️ Keyed by NAME, not by port. Matching a `*_SERVICE_URL` to "whichever sibling came first" passes a
     * one-sibling test and picks arbitrarily the moment there are two — which is this repo, where recipe
     * calls food and nothing else.
     */
    readonly siblings?: Readonly<Record<string, number>>;
}

/** Fixed local infrastructure addresses. Compose SERVICE NAMES, never localhost — see below. */
const LOCAL_INFRA: Readonly<Record<string, string>> = Object.freeze({
    DB_HOST: 'postgres',
    DB_PORT: '5432',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'postgres',
    POSTGRES_HOST: 'postgres',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    AWS_REGION: 'us-east-1',
    AWS_DEFAULT_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    NODE_ENV: 'development',
    STAGE: 'dev',
});

/**
 * Variables that are OMITTED rather than placeholdered.
 *
 * ⛔ A wrong value is worse than no value for these. They are third-party credentials and endpoints whose
 * valid form cannot be synthesised, and the services declare them OPTIONAL precisely because deployments
 * vary — so absence is a case the code already handles, while a bogus value is one it validates and
 * rejects. Measured: `SENTRY_DSN: 'local-placeholder'` put the identity container into a crash loop
 * spamming `Invalid Sentry Dsn`, with `/health` never answering. Omitting it, the app starts.
 *
 * ⚠️ This is deliberately narrow. The default for an unrecognised variable stays "a shaped placeholder",
 * because a MISSING variable that the code required would fail just as silently in the other direction.
 */
const OMITTED: readonly RegExp[] = [
    /_DSN$/u, // Sentry — a DSN has a specific form and is `.url().optional()` in every service here.
    /_API_KEY$|_SECRET$|_SIGNING_SECRET$/u, // Nothing local can hold a valid third-party credential.
    /^CLERK_JWT_KEY$|^CLERK_AUTHORIZED_PARTIES$|^CLERK_AZP_PATTERN$/u, // Real Clerk verification cannot work offline; the schemas make these optional off deployed stages.
];

/**
 * The environment one service container runs with locally.
 *
 * ⛔ SIBLINGS ARE REACHED BY COMPOSE SERVICE NAME, NEVER `localhost`. Inside a container `localhost` is that
 * container, so a URL of `http://localhost:3002` resolves to itself and the call refuses or hangs. This is
 * the single most common way a working process-based setup breaks the moment it is containerised, and the
 * repo's `.env.development` is full of exactly those localhost URLs.
 *
 * @param keys - Environment variable NAMES the task definition declares.
 * @param context - Local addresses for this service.
 * @returns Name → value, with no empty values. Pure.
 */
export function localContainerEnv(keys: readonly string[], context: LocalEnvContext): Readonly<Record<string, string>> {
    const env: Record<string, string> = { ...LOCAL_INFRA, PORT: String(context.port) };

    for (const key of keys) {
        // ⚠️ `env` here, not `LOCAL_INFRA`. PORT is computed rather than constant, and task definitions DO
        // declare it — so checking only the constant let the loop overwrite the real port with
        // `local-placeholder`, and the container then bound a port nothing published. Caught by running it.
        if (key in env) {
            continue;
        }

        if (/(^|_)(DB_NAME|DATABASE_NAME|POSTGRES_DB)$/u.test(key)) {
            env[key] = context.database;
            continue;
        }

        // A sibling service URL — matched by the variable's OWN name, so `FOOD_SERVICE_URL` finds the
        // `food` service and cannot silently resolve to whichever sibling happens to be first.
        const wanted = /^([A-Z0-9]+)_SERVICE_URL$/u.exec(key)?.[1]?.toLowerCase();
        const siblingPort = wanted === undefined ? undefined : context.siblings?.[wanted];

        if (wanted !== undefined && siblingPort !== undefined) {
            env[key] = `http://${wanted}:${String(siblingPort)}`;
            continue;
        }

        if (OMITTED.some((pattern) => pattern.test(key))) {
            continue;
        }

        // ⛔ Never empty. `process.env['X'] ?? fallback` treats an empty string as PRESENT, so the service
        // would take a configured path with no configuration.
        env[key] = inferPlaceholder(key);
    }

    return env;
}

/**
 * Host ports already taken by something else.
 *
 * ⛔ Checked BEFORE the containers start, because otherwise the failure is a docker networking error —
 * "failed to bind host port 0.0.0.0:3000/tcp: address already in use" — arriving after several minutes of
 * image builds, naming a port but not which service wanted it. Observed on the first full run.
 *
 * Not hypothetical: `recipe-service` defaults to 3000, the Next.js convention, and therefore the most
 * contended port on a web developer's machine.
 *
 * @param wanted - The services and the host ports they need.
 * @param inUse - Ports already listening.
 * @returns The clashing services. Pure.
 */
export function portConflicts(
    wanted: readonly { readonly name: string; readonly hostPort: number }[],
    inUse: readonly number[],
): readonly { readonly name: string; readonly hostPort: number }[] {
    const taken = new Set(inUse);

    return wanted.filter((service) => taken.has(service.hostPort));
}
