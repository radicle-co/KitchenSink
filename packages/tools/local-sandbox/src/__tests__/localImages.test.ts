/**
 * Repo-wide guard: building the service images locally, and pointing the local stack at them.
 *
 * ## What the CDK can and cannot tell us
 *
 * The stacks use `ContainerImage.fromEcrRepository`, so they REFERENCE a prebuilt tag and every asset
 * manifest carries `dockerImages: []`. The CDK therefore names the repository — `kitchensink-food` — but
 * says nothing about how to build it. That half is stated elsewhere in the repo, and is read rather than
 * invented:
 *
 * - WHICH package: the app that synthesised the stack the task definition lives in.
 * - HOW to prepare: that package's own `docker:prepare` script, which CI runs immediately before
 *   `docker buildx` and which generates the `prod.package.json` the Dockerfile COPYs.
 * - WHERE from: `-f <package>/Dockerfile` with the REPO ROOT as context, exactly as CI invokes it — the
 *   Dockerfile COPYs `packages/shared/...` paths that only exist relative to the root.
 *
 * ⚠️ The build context is the single easiest thing to get wrong here. A Dockerfile that COPYs
 * `packages/shared/clerk-verify/dist` cannot build with the service directory as context, and the error is
 * a confusing "file not found" against a path that plainly exists.
 */
import { describe, expect, it } from 'vitest';

import { discoverImageBuilds, localContainerEnv, portConflicts } from '../localImages.js';

const taskTemplate = (image: unknown): unknown => ({
    Resources: {
        ApiTask: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: { ContainerDefinitions: [{ Image: image, PortMappings: [{ ContainerPort: 3000 }] }] },
        },
    },
});

const app = { packageName: '@kitchensink/food-service', packageDir: 'packages/services/food-service' };

describe('discoverImageBuilds', () => {
    it('reads the repository name out of a Fn::Join image reference', () => {
        const builds = discoverImageBuilds(
            'FoodService-dev',
            taskTemplate({
                'Fn::Join': ['', ['1234.dkr.ecr.us-east-1.', { Ref: 'AWS::URLSuffix' }, '/kitchensink-food:abc123']],
            }),
            app,
        );

        expect(builds).toEqual([
            {
                stack: 'FoodService-dev',
                logicalId: 'ApiTask',
                repository: 'kitchensink-food',
                localImage: 'local-sandbox/kitchensink-food:local',
                packageName: '@kitchensink/food-service',
                dockerfile: 'packages/services/food-service/Dockerfile',
                containerPort: 3000,
            },
        ]);
    });

    it('reads a plain string image too', () => {
        const [build] = discoverImageBuilds(
            'S',
            taskTemplate('1234.dkr.ecr.us-east-1.amazonaws.com/kitchensink-identity:v1'),
            {
                packageName: '@kitchensink/identity-service',
                packageDir: 'packages/services/identity',
            },
        );

        expect(build?.repository).toBe('kitchensink-identity');
    });

    it('de-duplicates by repository — three task definitions on one image build it ONCE', () => {
        // food declares api, worker and change-refresh, all on `kitchensink-food`. Building three times
        // would triple the slowest step in the whole command for no benefit.
        const image = '1234.dkr.ecr.us-east-1.amazonaws.com/kitchensink-food:v1';
        const template = {
            Resources: {
                A: { Type: 'AWS::ECS::TaskDefinition', Properties: { ContainerDefinitions: [{ Image: image }] } },
                B: { Type: 'AWS::ECS::TaskDefinition', Properties: { ContainerDefinitions: [{ Image: image }] } },
            },
        };

        expect(new Set(discoverImageBuilds('S', template, app).map((b) => b.localImage)).size).toBe(1);
    });

    it('ignores a task definition with no resolvable repository rather than inventing one', () => {
        expect(discoverImageBuilds('S', taskTemplate({ Ref: 'SomethingElse' }), app)).toEqual([]);
    });
});

describe('localContainerEnv', () => {
    const base = { database: 'kitchensink_food_dev', port: 3002 };

    it('points the database variables at the compose Postgres, not at RDS', () => {
        const env = localContainerEnv(['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD'], base);

        expect(env['DB_HOST']).toBe('postgres');
        expect(env['DB_PORT']).toBe('5432');
        expect(env['DB_NAME']).toBe('kitchensink_food_dev');
        expect(env['DB_USERNAME']).toBe('postgres');
        expect(env['DB_PASSWORD']).toBe('postgres');
    });

    it('points every AWS SDK call at LocalStack', () => {
        const env = localContainerEnv(['FOOD_EVENT_BUS_NAME'], base);

        expect(env['AWS_ENDPOINT_URL']).toBe('http://localstack:4566');
        expect(env['AWS_REGION']).toBe('us-east-1');
    });

    it('uses the service container port, so it matches what compose publishes', () => {
        expect(localContainerEnv([], base)['PORT']).toBe('3002');
    });

    /**
     * ⛔ Regression. Task definitions DECLARE `PORT`, and the first draft only skipped keys present in the
     * constant infra table — PORT is computed, not constant, so the loop overwrote it with
     * `local-placeholder`. The container then bound a port nothing published, and compose reported it
     * unhealthy with no clue why. Found by running the command, not by reading it.
     */
    it('does not let a declared PORT key overwrite the computed one', () => {
        expect(localContainerEnv(['PORT', 'DB_HOST'], base)['PORT']).toBe('3002');
        expect(localContainerEnv(['PORT', 'DB_HOST'], base)['DB_HOST']).toBe('postgres');
    });

    /**
     * ⛔ The container reaches its siblings by COMPOSE SERVICE NAME, never `localhost`. Inside a container,
     * `localhost` is that container — a URL of `http://localhost:3002` resolves to itself and the call hangs
     * or refuses. This is the single most common way a working process-based setup breaks when it is moved
     * into containers.
     */
    it('rewrites a sibling URL to the compose service name, matched by the variable name', () => {
        const env = localContainerEnv(['FOOD_SERVICE_URL'], {
            ...base,
            siblings: {
                food: { hostPort: 3002, containerPort: 3000 },
                identity: { hostPort: 3001, containerPort: 3000 },
            },
        });

        // ⚠️ REWRITTEN: this asserted `:3002`, the published HOST port. Inside the compose network food
        // listens on 3000, so that address hit nothing — see the container-port describe below.
        expect(env['FOOD_SERVICE_URL']).toBe('http://food:3000');
    });

    it('picks the RIGHT sibling when there is more than one', () => {
        // Anti-vacuity: the first draft matched "whichever sibling came first", which passed the single
        // -sibling test above and would have wired recipe at identity.
        const env = localContainerEnv(['IDENTITY_SERVICE_URL', 'FOOD_SERVICE_URL'], {
            ...base,
            siblings: {
                food: { hostPort: 3002, containerPort: 3000 },
                identity: { hostPort: 3001, containerPort: 3000 },
            },
        });

        // ⚠️ REWRITTEN alongside FOOD_SERVICE_URL: 3001 is identity's published HOST port; inside the
        // network it listens on 3000 like every other service.
        expect(env['IDENTITY_SERVICE_URL']).toBe('http://identity:3000');
        // ⚠️ REWRITTEN: this asserted `:3002`, the published HOST port. Inside the compose network food
        // listens on 3000, so that address hit nothing — see the container-port describe below.
        expect(env['FOOD_SERVICE_URL']).toBe('http://food:3000');
    });

    it('leaves a service URL with no matching sibling as a placeholder, not a wrong address', () => {
        expect(localContainerEnv(['MYSTERY_SERVICE_URL'], base)['MYSTERY_SERVICE_URL']).toMatch(/^https?:\/\//u);
    });

    it('falls back to a shaped placeholder for anything unrecognised', () => {
        expect(localContainerEnv(['SOME_SECRET_ARN'], base)['SOME_SECRET_ARN']).toMatch(/^arn:aws:/u);
    });

    /**
     * ⛔ Regression, found by running it. `SENTRY_DSN: 'local-placeholder'` is not a URL, and the identity
     * container crash-looped on `Invalid Sentry Dsn` with `/health` never answering. The schema declares it
     * `.url().optional()`, so ABSENCE is a handled case and a bogus value is not.
     */
    it('OMITS credentials whose valid form cannot be synthesised, rather than inventing one', () => {
        const env = localContainerEnv(['SENTRY_DSN', 'CLERK_JWT_KEY', 'USDA_API_KEY', 'DB_HOST'], base);

        expect(env['SENTRY_DSN']).toBeUndefined();
        expect(env['CLERK_JWT_KEY']).toBeUndefined();
        expect(env['USDA_API_KEY']).toBeUndefined();
        // …but still sets everything it CAN, so the omission is targeted rather than a blanket give-up.
        expect(env['DB_HOST']).toBe('postgres');
    });

    it('never emits an empty value, which would read as "set" and take a fallback path', () => {
        for (const value of Object.values(localContainerEnv(['A_URL', 'B_ID', 'WHATEVER'], base))) {
            expect(value.length).toBeGreaterThan(0);
        }
    });
});

describe('portConflicts', () => {
    /**
     * ⛔ Without this the failure is a docker networking error — "failed to bind host port 0.0.0.0:3000/tcp:
     * address already in use" — printed after several minutes of image builds, naming a port but not which
     * service wanted it or why. Observed exactly that on the first full run.
     *
     * It is also not a hypothetical clash: `recipe-service` defaults to 3000, which is the Next.js
     * convention and therefore the single most contended port on a web developer's machine.
     */
    it('names the service, the port, and stays quiet when nothing clashes', () => {
        const wanted = [
            { name: 'recipes', hostPort: 3000 },
            { name: 'identity', hostPort: 3001 },
        ];

        expect(portConflicts(wanted, [3000])).toEqual([{ name: 'recipes', hostPort: 3000 }]);
        expect(portConflicts(wanted, [9999])).toEqual([]);
    });

    it('reports every clash, not just the first', () => {
        expect(
            portConflicts(
                [
                    { name: 'a', hostPort: 1 },
                    { name: 'b', hostPort: 2 },
                ],
                [1, 2],
            ),
        ).toHaveLength(2);
    });
});

describe('localContainerEnv — values resolved from AWS', () => {
    /**
     * ⛔ PRECEDENCE, AND WHY IT IS NOT "AWS WINS" OR "LOCAL WINS". Three kinds of value meet here and the
     * order between them is the whole point:
     *
     *   - LOCAL INFRASTRUCTURE (`DB_HOST`, `DB_USERNAME`, `AWS_ENDPOINT_URL`, `PORT`) must beat AWS. These
     *     name the compose containers; the deployed values point at RDS and the real AWS endpoints, and a
     *     container handed a production DB password simply fails to connect.
     *   - A value RESOLVED FROM AWS must beat a placeholder. `local-placeholder` is a last resort for
     *     something nothing can supply — when the real value is a public key sitting in SSM, using the
     *     placeholder instead is a choice to be wrong.
     *   - A resolved value must also beat OMISSION, which is how `CLERK_JWT_KEY` came to be missing entirely
     *     and recipe-service refused to boot.
     */
    it('prefers local infrastructure over anything resolved from AWS', () => {
        const env = localContainerEnv(['DB_HOST'], {
            database: 'db',
            port: 3000,
            resolved: { DB_HOST: 'prod.rds.amazonaws.com', DB_PASSWORD: 'hunter2' },
        });

        expect(env['DB_HOST']).toBe('postgres');
        expect(env['DB_PASSWORD']).toBe('postgres');
    });

    it('prefers a resolved value over a placeholder', () => {
        const env = localContainerEnv(['SOME_SETTING'], {
            database: 'db',
            port: 3000,
            resolved: { SOME_SETTING: 'real-value' },
        });

        expect(env['SOME_SETTING']).toBe('real-value');
    });

    it('supplies a resolved value for a key that is OMITTED when unresolvable', () => {
        // CLERK_JWT_KEY is in OMITTED because nothing local can invent one. A real one from SSM is not an
        // invention.
        const env = localContainerEnv(['CLERK_JWT_KEY'], {
            database: 'db',
            port: 3000,
            resolved: { CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----' },
        });

        expect(env['CLERK_JWT_KEY']).toBe('-----BEGIN PUBLIC KEY-----');
    });

    it('still omits an OMITTED key that nothing resolved', () => {
        const env = localContainerEnv(['CLERK_JWT_KEY', 'SENTRY_DSN'], { database: 'db', port: 3000, resolved: {} });

        expect(env['CLERK_JWT_KEY']).toBeUndefined();
        expect(env['SENTRY_DSN']).toBeUndefined();
    });

    it('includes a resolved variable the task definition never declared as env', () => {
        // ⛔ A SECRET IS NOT IN `Environment`. `USDA_API_KEY` reaches the container only through `Secrets`, so
        // it is absent from `keys` — iterating `keys` alone would drop the very value this exists to supply.
        const env = localContainerEnv([], { database: 'db', port: 3000, resolved: { USDA_API_KEY: 'abc123' } });

        expect(env['USDA_API_KEY']).toBe('abc123');
    });
});

describe('localContainerEnv — STAGE selects the database auth mode', () => {
    /**
     * ⛔ `STAGE` IS NOT COSMETIC HERE; it is the switch between two incompatible ways of connecting to
     * Postgres, and getting it wrong produces a stack that looks healthy and serves nothing.
     *
     * Every service gates on the literal `'local'`:
     *
     *     if (process.env['STAGE'] === 'local') { return { ...base, ssl: false, password }; }
     *     // otherwise: RDS IAM auth — a signed token, over TLS
     *
     * (`recipe-service/src/database/poolConfig.ts`, `food-service/src/database/poolConfig.ts`,
     * `identity-webhooks/src/common/db.ts`, `identity/src/lambdas/migrate/handler.ts`.)
     *
     * With `STAGE: 'dev'` all three containers tried to IAM-sign a TLS connection to a plain postgres
     * container that speaks neither. Measured: `/health` answered `200 {"status":"ok"}` — liveness does not
     * touch the database — while `/health/ready` answered `503 NOT_READY: Database not reachable` on every
     * service. The credentials were correct the whole time; a `pg` client built by hand inside the same
     * container ran `select 1` successfully.
     *
     * That is the failure this asserts against: the liveness probe, the container healthcheck and
     * `docker ps` all reported healthy, so nothing in the startup output suggested the database was
     * unreachable.
     */
    it('sets STAGE=local, because every service reads that literal to disable SSL and IAM', () => {
        const env = localContainerEnv([], { database: 'db', port: 3000 });

        expect(env['STAGE']).toBe('local');
    });

    it('keeps STAGE local even when the task definition declares its own', () => {
        // The deployed task definitions declare STAGE, so it arrives in `keys` and must not be
        // placeholdered or overwritten back to a deployed stage name.
        const env = localContainerEnv(['STAGE'], { database: 'db', port: 3000, resolved: { STAGE: 'sandbox' } });

        expect(env['STAGE']).toBe('local');
    });
});

describe('localContainerEnv — DATABASE_URL', () => {
    /**
     * ⛔ THE LOCAL POSTGRES SPEAKS NO TLS, and two services reach that conclusion by different routes.
     *
     * `recipe-service` and `food-service` branch on `STAGE === 'local'` to turn SSL off. `identity` does NOT:
     * `database.module.ts` appends `?sslmode=no-verify` unconditionally, with a comment explaining that RDS
     * needs it. Against the postgres container that is fatal, and postgres says so exactly:
     *
     *     server does not support SSL, but SSL was required
     *
     * Measured: with `STAGE=local` alone, food and recipe answered `/health/ready` 200 and identity still
     * answered `503 NOT_READY: Database not reachable`.
     *
     * All three read `DATABASE_URL` FIRST when it is present (`recipePoolConfigFromEnv`,
     * `foodPoolConfigFromEnv`, `buildConnectionString`), and each names it in its own error text as the
     * supported alternative to the discrete `DB_*` set. So one computed URL fixes every service through the
     * escape hatch they already document, instead of three per-service special cases.
     *
     * ⚠️ It carries the SERVICE'S OWN database, not a fixed name — the whole point of `context.database`.
     */
    it('supplies a plain, SSL-free DATABASE_URL naming this service database', () => {
        const env = localContainerEnv([], { database: 'kitchensink_identity', port: 3000 });

        expect(env['DATABASE_URL']).toBe('postgresql://postgres:postgres@postgres:5432/kitchensink_identity');
    });

    it('names each service own database rather than a shared one', () => {
        const food = localContainerEnv([], { database: 'kitchensink_food_dev', port: 3000 });
        const recipes = localContainerEnv([], { database: 'kitchensink_recipes_dev', port: 3000 });

        expect(food['DATABASE_URL']).toContain('/kitchensink_food_dev');
        expect(recipes['DATABASE_URL']).toContain('/kitchensink_recipes_dev');
    });

    it('carries no sslmode, because requesting TLS is the failure being avoided', () => {
        const env = localContainerEnv([], { database: 'db', port: 3000 });

        expect(env['DATABASE_URL']).not.toContain('sslmode');
    });
});

describe('portConflicts — the stack own containers are not a conflict', () => {
    /**
     * ⛔ `local:up` MUST BE RE-RUNNABLE WHILE THE STACK IS UP, which is the normal case: you change a
     * service, run it again, and expect the stack to be reconciled. The first version compared the wanted
     * ports against every listening socket — including the ones this project publishes — so the second run
     * refused with:
     *
     *     Refusing to start: host port(s) already in use.
     *       recipes wants :3000 — free it, or stop whatever is listening.
     *
     * naming its OWN container as the squatter. `docker compose up` reconciles a running stack perfectly
     * well; the guard exists for a FOREIGN listener (a `next dev` on 3000), and it has to tell the two apart.
     */
    it('ignores a port this project already publishes', () => {
        const clashes = portConflicts([{ name: 'recipes', hostPort: 3000 }], [3000], [3000]);

        expect(clashes).toStrictEqual([]);
    });

    it('still reports a foreign listener on a port we do not own', () => {
        const clashes = portConflicts([{ name: 'recipes', hostPort: 3000 }], [3000], []);

        expect(clashes).toStrictEqual([{ name: 'recipes', hostPort: 3000 }]);
    });

    it('separates the two in one call', () => {
        const clashes = portConflicts(
            [
                { name: 'recipes', hostPort: 3000 },
                { name: 'food', hostPort: 3002 },
            ],
            [3000, 3002],
            [3000],
        );

        expect(clashes).toStrictEqual([{ name: 'food', hostPort: 3002 }]);
    });
});

describe('localContainerEnv — the azp ORIGIN policy is local, never the deployed one', () => {
    /**
     * ⛔ RESOLVING THIS ONE FROM AWS BREAKS AUTH LOCALLY. Pulling `CLERK_JWT_KEY` from SSM is right — it is
     * verification MATERIAL and the same key everywhere. `CLERK_AZP_PATTERN` is different: it is stage
     * ORIGIN policy, it arrives as `sandbox.commise.app`, and the patterns built from it are anchored to
     * `https://` (`buildTransitionAzpPattern` → `^https://(?:pr-\d+\.)?…$`). A local origin is
     * `http://localhost:<port>`, so it can NEVER match — pattern mode is structurally unusable locally.
     *
     * Measured: a real, correctly-signed Clerk token carrying a valid `external_id` was rejected 401 by all
     * three services, because `assertAzpMatchesPattern` refuses an ABSENT `azp` (which is what a
     * backend-minted token has) unless the token is a native client.
     *
     * The services require EXACTLY ONE of `CLERK_AUTHORIZED_PARTIES` or `CLERK_AZP_PATTERN` — their own
     * validation says so — so supplying the list means the pattern must be suppressed, not merely
     * overridden. `local-sandbox` cannot "unset" a resolved value, so the suppression is explicit.
     */
    it('supplies the local origin as an authorized party', () => {
        const env = localContainerEnv([], { database: 'db', port: 3000 });

        expect(env['CLERK_AUTHORIZED_PARTIES']).toContain('http://localhost:');
    });

    it('takes the origin from the environment when one is given', () => {
        const env = localContainerEnv([], { database: 'db', port: 3000, webOrigin: 'http://localhost:4321' });

        expect(env['CLERK_AUTHORIZED_PARTIES']).toBe('http://localhost:4321');
    });

    it('SUPPRESSES a CLERK_AZP_PATTERN resolved from AWS, because the two are mutually exclusive', () => {
        const env = localContainerEnv(['CLERK_AZP_PATTERN'], {
            database: 'db',
            port: 3000,
            resolved: { CLERK_AZP_PATTERN: 'sandbox.commise.app', CLERK_AZP_PREVIEW_MODE: 'transition' },
        });

        expect(env['CLERK_AZP_PATTERN']).toBeUndefined();
        expect(env['CLERK_AZP_PREVIEW_MODE']).toBeUndefined();
    });

    it('still takes CLERK_JWT_KEY from AWS — material, not origin policy', () => {
        const env = localContainerEnv(['CLERK_JWT_KEY'], {
            database: 'db',
            port: 3000,
            resolved: { CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----' },
        });

        expect(env['CLERK_JWT_KEY']).toBe('-----BEGIN PUBLIC KEY-----');
    });
});

describe('localContainerEnv — a sibling URL uses the CONTAINER port', () => {
    /**
     * ⛔ THE HOST PORT IS NOT THE CONTAINER PORT, and using it makes every cross-service call fail in a way
     * that is REPORTED AS SOMETHING ELSE. Compose publishes food as `3002:3000` — 3002 on the host, 3000
     * inside the network. Recipe-service reached it by compose service NAME, which is right, but on the HOST
     * port, so `http://food:3002` hit a port nothing listens on.
     *
     * Measured over a 348-recipe import: all 1832 ingredient lookups were counted as
     * "lookups during a catalog outage", 0 lines carried a real `food_id`, and the import still reported
     * success — because the recipe service degrades to `catalogAvailability: 'unavailable'` by design rather
     * than failing the write. A connection refused on the wrong port is indistinguishable, downstream, from
     * a food service that is genuinely down.
     */
    it('addresses a sibling on its container port, not the published host port', () => {
        const env = localContainerEnv(['FOOD_SERVICE_URL'], {
            database: 'db',
            port: 3000,
            siblings: { food: { hostPort: 3002, containerPort: 3000 } },
        });

        expect(env['FOOD_SERVICE_URL']).toBe('http://food:3000');
    });

    it('still matches the sibling by its OWN name', () => {
        const env = localContainerEnv(['FOOD_SERVICE_URL'], {
            database: 'db',
            port: 3000,
            siblings: {
                food: { hostPort: 3002, containerPort: 3000 },
                identity: { hostPort: 3001, containerPort: 3000 },
            },
        });

        expect(env['FOOD_SERVICE_URL']).toBe('http://food:3000');
    });
});
