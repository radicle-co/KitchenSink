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
        const env = localContainerEnv(['FOOD_SERVICE_URL'], { ...base, siblings: { food: 3002, identity: 3001 } });

        expect(env['FOOD_SERVICE_URL']).toBe('http://food:3002');
    });

    it('picks the RIGHT sibling when there is more than one', () => {
        // Anti-vacuity: the first draft matched "whichever sibling came first", which passed the single
        // -sibling test above and would have wired recipe at identity.
        const env = localContainerEnv(['IDENTITY_SERVICE_URL', 'FOOD_SERVICE_URL'], {
            ...base,
            siblings: { food: 3002, identity: 3001 },
        });

        expect(env['IDENTITY_SERVICE_URL']).toBe('http://identity:3001');
        expect(env['FOOD_SERVICE_URL']).toBe('http://food:3002');
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
