/**
 * Repo-wide guard: what a local sandbox must RUN — the migrations and the services — read out of the
 * synthesised CDK rather than named here.
 *
 * ## Why migrations are not optional, and why they are not "just another container"
 *
 * ADR-0022 puts an `aws-cdk-lib/triggers` Trigger in every stack that touches the database, ordered ahead of
 * the ECS services in the same stack, because `cdk deploy` returns only once ECS has stabilised — so
 * "deploy, then migrate" served the new image against the OLD schema for the whole stabilisation window.
 * Locally there is no deploy to order against, and the equivalent obligation is exactly this: apply the
 * ordered SQL BEFORE any service starts. A local stack that skips it comes up healthy and 500s on the first
 * real query, which is the same failure the ADR was written about.
 *
 * The SQL is not written down here. It is inside the CDK's own Lambda asset — `Code.S3Key` names the asset
 * hash, and `cdk.out/asset.<hash>/migrations/` holds the ordered files. A new migration is picked up because
 * it is in the bundle the CDK built, not because anyone told this package about it.
 *
 * ## Why local ports come from each service's own env schema
 *
 * Every container binds 3000 in the deployed world and is separated by host-based ALB routing, so the
 * template cannot say which local port a service should take. The repo already answers that question
 * elsewhere: each service's `PORT` default (identity 3001, food 3002, recipe 3000). Reading those is
 * derivation; inventing an allocation here would be a second, competing convention that the existing
 * `.env.development` cross-service URLs would immediately contradict.
 */
import { describe, expect, it } from 'vitest';

import {
    discoverDatabases,
    discoverMigrations,
    discoverSeedFunctions,
    discoverServiceTasks,
    migrationCoverageGaps,
    resolveExports,
    resolveSsmParameters,
    sharedLiteralEnv,
} from '../runPlan.js';

const template = (resources: Record<string, unknown>): unknown => ({ Resources: resources });

/**
 * ⚠️ REWRITTEN for the schema stacks (ADR-0035): the migration set is the one the stack's RUNNER holds, found by the
 * `*MigrationFunctionName` output every runner publishes. It used to be every asset-backed Lambda with a
 * `migrations/` folder, which was safe only while `local:up` could not resolve a non-runner stack's database. Once it
 * could, a stale `migrations/` left in another package's build output became a migration set.
 */
describe('discoverMigrations', () => {
    const runner = {
        Type: 'AWS::Lambda::Function',
        Properties: { Code: { S3Key: 'abc123.zip' }, Handler: 'lambdas/migrate/handler.handler' },
    };
    const withOutputs = (resources: Record<string, unknown>, outputs: Record<string, unknown>): unknown => ({
        Resources: resources,
        Outputs: outputs,
    });

    it('finds the runner by the output it publishes, and carries the hash the SQL lives under', () => {
        const found = discoverMigrations(
            'kitchensink-food-schema-dev',
            withOutputs(
                { FoodMigrationFunction: runner },
                { FoodMigrationFunctionName: { Value: { Ref: 'FoodMigrationFunction' } } },
            ),
        );

        expect(found).toEqual([
            { stack: 'kitchensink-food-schema-dev', logicalId: 'FoodMigrationFunction', assetHash: 'abc123' },
        ]);
    });

    it.each<[string, unknown]>([
        [
            'an asset-backed Lambda no runner output names (a stale `migrations/` in another build)',
            withOutputs({ WebhookFunction: runner }, {}),
        ],
        [
            'the seed function beside the runner',
            withOutputs(
                { FoodSeedFunction: { ...runner, Properties: { Code: { S3Key: 'seed.zip' } } } },
                { FoodSeedFunctionName: { Value: { Ref: 'FoodSeedFunction' } } },
            ),
        ],
        [
            'a runner synthesized as its inline placeholder, which carries no bundle',
            withOutputs(
                { F: { Type: 'AWS::Lambda::Function', Properties: { Code: { ZipFile: 'exports.h=1' } } } },
                { FoodMigrationFunctionName: { Value: { Ref: 'F' } } },
            ),
        ],
        [
            'a resource that is not a Lambda, named by a runner output',
            withOutputs(
                { X: { Type: 'AWS::S3::Bucket', Properties: { Code: { S3Key: 'a.zip' } } } },
                { FoodMigrationFunctionName: { Value: { Ref: 'X' } } },
            ),
        ],
    ])('ignores %s', (_case, template) => {
        expect(discoverMigrations('S', template)).toEqual([]);
    });
});

/**
 * A database the stacks name and no runner migrates comes up with no schema, and every service on it fails on its first
 * query. Two runners on one database would apply two migration sets to it.
 */
describe('migrationCoverageGaps', () => {
    it('passes when each database has exactly one runner', () => {
        expect(
            migrationCoverageGaps(
                ['food', 'recipe'],
                new Map([
                    ['food', ['kitchensink-food-schema-dev']],
                    ['recipe', ['kitchensink-recipe-schema-dev']],
                ]),
            ),
        ).toStrictEqual([]);
    });

    it.each<[string, readonly string[], ReadonlyMap<string, readonly string[]>, string]>([
        [
            'a database no runner migrates',
            ['food', 'identity'],
            new Map([['food', ['f']]]),
            'identity: no migration runner',
        ],
        [
            'a database two runners migrate',
            ['food'],
            new Map([['food', ['kitchensink-food-schema-dev', 'kitchensink-other-dev']]]),
            'food: 2 migration runners (kitchensink-food-schema-dev, kitchensink-other-dev)',
        ],
    ])('names %s', (_case, databases, migratedBy, message) => {
        expect(migrationCoverageGaps(databases, migratedBy)).toStrictEqual([message]);
    });
});

/**
 * ⚠️ REWRITTEN for GATE m1: the seed function is found by the `*SeedFunctionName` output its stack publishes for the
 * pipeline, as migration runners are found by theirs. It used to be found by a metadata key written in two packages
 * with nothing tying them together.
 */
describe('discoverSeedFunctions', () => {
    /** The seed function as `FoodSchemaStack` synthesizes it when its bundle was built. */
    const bundledSeed = {
        Type: 'AWS::Lambda::Function',
        Properties: { Code: { S3Key: 'seedhash.zip' }, Handler: 'lambdas/seed/handler.handler' },
    };
    /** The migration function beside it: an asset-backed Lambda that is not the seed. */
    const migration = {
        Type: 'AWS::Lambda::Function',
        Properties: { Code: { S3Key: 'migratehash.zip' }, Handler: 'lambdas/migrate/handler.handler' },
    };
    const withSeedOutput = (resources: Record<string, unknown>, ref: string): unknown => ({
        Resources: resources,
        Outputs: {
            FoodSeedFunctionName: { Value: { Ref: ref } },
            FoodMigrationFunctionName: { Value: { Ref: 'migration' } },
        },
    });

    it('finds the seed function by the output it publishes, with the asset hash and the module its handler names', () => {
        expect(
            discoverSeedFunctions(
                'kitchensink-food-schema-dev',
                withSeedOutput({ FoodSeedFunction: bundledSeed, migration }, 'FoodSeedFunction'),
            ),
        ).toEqual([
            {
                kind: 'bundled',
                stack: 'kitchensink-food-schema-dev',
                logicalId: 'FoodSeedFunction',
                assetHash: 'seedhash',
                module: 'lambdas/seed/handler.js',
            },
        ]);
    });

    it.each<[string, Record<string, unknown>, string]>([
        [
            'a seed function whose bundle was not built (the stack synthesized its throwing placeholder)',
            {
                FoodSeedFunction: {
                    ...bundledSeed,
                    Properties: { Code: { ZipFile: 'exports.handler = async () => { throw new Error("missing"); };' } },
                },
            },
            'FoodSeedFunction',
        ],
        [
            'a bundled seed function whose handler names no module',
            { FoodSeedFunction: { ...bundledSeed, Properties: { Code: { S3Key: 'seedhash.zip' } } } },
            'FoodSeedFunction',
        ],
        ['a seed output naming a resource that is not a Lambda', { B: { Type: 'AWS::S3::Bucket' } }, 'B'],
        ['a seed output naming a resource the stack does not hold', {}, 'Gone'],
    ])('reports %s as unbuilt, rather than dropping it', (_case, resources, ref) => {
        expect(discoverSeedFunctions('S', withSeedOutput(resources, ref))).toEqual([
            { kind: 'unbuilt', stack: 'S', logicalId: ref },
        ]);
    });

    it('finds nothing in a stack that publishes no seed output, whatever Lambdas it holds', () => {
        expect(discoverSeedFunctions('S', template({ FoodSeedFunction: bundledSeed, migration }))).toEqual([]);
    });
});

describe('discoverServiceTasks', () => {
    it('reads the container port and env keys off the task definition', () => {
        const found = discoverServiceTasks(
            'FoodService-dev',
            template({
                FoodApiTaskDefinition: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [
                            {
                                PortMappings: [{ ContainerPort: 3000, Protocol: 'tcp' }],
                                Environment: [
                                    { Name: 'NODE_ENV', Value: 'production' },
                                    { Name: 'DB_NAME', Value: 'kitchensink_food_dev' },
                                ],
                            },
                        ],
                    },
                },
            }),
        );

        expect(found).toEqual([
            {
                stack: 'FoodService-dev',
                logicalId: 'FoodApiTaskDefinition',
                containerPort: 3000,
                envKeys: ['DB_NAME', 'NODE_ENV'],
            },
        ]);
    });

    it('reports a task definition with no port mapping rather than dropping it', () => {
        // A worker has no inbound port and still has to run — dropping it would silently omit the drainer.
        const [task] = discoverServiceTasks(
            'S',
            template({ W: { Type: 'AWS::ECS::TaskDefinition', Properties: { ContainerDefinitions: [{}] } } }),
        );

        expect(task?.containerPort).toBeUndefined();
        expect(task?.logicalId).toBe('W');
    });

    it('ignores everything that is not a task definition', () => {
        expect(discoverServiceTasks('S', template({ C: { Type: 'AWS::ECS::Cluster' } }))).toEqual([]);
    });

    it('sorts env keys, so a reordered template is not a diff', () => {
        const [task] = discoverServiceTasks(
            'S',
            template({
                T: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [
                            {
                                Environment: [
                                    { Name: 'Z', Value: '1' },
                                    { Name: 'A', Value: '2' },
                                ],
                            },
                        ],
                    },
                },
            }),
        );

        expect(task?.envKeys).toEqual(['A', 'Z']);
    });
});

describe('resolveExports + discoverDatabases', () => {
    /**
     * ⛔ The reason this exists. `IdentityService-dev` names its database as
     * `{ Fn::ImportValue: 'kitchensink-data-dev:DatabaseName' }`, and the global Data stack is what
     * declares the concrete value. Without resolving the import, the identity stack "names 0 databases" and
     * its migrations are silently skipped — which is how a sandbox comes up with an EMPTY identity schema
     * and 500s on the first sign-in. Measured: 44 files applied to food and recipe, 0 to identity.
     */
    it('resolves an ImportValue against another stack Outputs', () => {
        const exports_ = resolveExports([
            {
                Outputs: {
                    A: { Export: { Name: 'kitchensink-data-dev:DatabaseName' }, Value: 'kitchensink_identity' },
                },
            },
        ]);

        expect(
            discoverDatabases(
                [
                    {
                        Resources: {
                            T: {
                                Type: 'AWS::ECS::TaskDefinition',
                                Properties: {
                                    ContainerDefinitions: [
                                        {
                                            Environment: [
                                                {
                                                    Name: 'DB_NAME',
                                                    Value: { 'Fn::ImportValue': 'kitchensink-data-dev:DatabaseName' },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                ],
                exports_,
                {},
            ),
        ).toEqual(['kitchensink_identity']);
    });

    /**
     * ⛔ A schema stack's migration runner is a Lambda, and a Lambda states its environment as a `Variables` map, not
     * the task definition's `[{ Name, Value }]` list (ADR-0035). Reading only the list left every schema stack naming
     * no database, so `local:up` applied no migration at all and called the skip "fine".
     */
    it.each<[string, Record<string, unknown>, Record<string, string>, readonly string[]]>([
        ['a literal', { STAGE: 'dev', FOOD_DB_NAME: 'kitchensink_food_dev' }, {}, ['kitchensink_food_dev']],
        [
            'an import',
            { DB_NAME: { 'Fn::ImportValue': 'kitchensink-data-dev:DatabaseName' } },
            { 'kitchensink-data-dev:DatabaseName': 'kitchensink_identity' },
            ['kitchensink_identity'],
        ],
        ['a key that names no database', { FOOD_DB_ENDPOINT: 'localhost', STAGE: 'dev' }, {}, []],
    ])('finds a database a Lambda names in its environment Variables, as %s', (_case, variables, exports_, found) => {
        expect(
            discoverDatabases(
                [
                    {
                        Resources: {
                            F: { Type: 'AWS::Lambda::Function', Properties: { Environment: { Variables: variables } } },
                        },
                    },
                ],
                exports_,
                {},
            ),
        ).toEqual(found);
    });

    it('still finds a plainly-stated database name', () => {
        expect(
            discoverDatabases(
                [{ Resources: { D: { Type: 'AWS::RDS::DBInstance', Properties: { DBName: 'kitchensink_food' } } } }],
                {},
                {},
            ),
        ).toEqual(['kitchensink_food']);
    });

    it('ignores an ImportValue nothing exports, rather than inventing a database', () => {
        expect(
            discoverDatabases(
                [
                    {
                        Resources: {
                            T: {
                                Type: 'AWS::ECS::TaskDefinition',
                                Properties: {
                                    ContainerDefinitions: [
                                        {
                                            Environment: [
                                                { Name: 'DB_NAME', Value: { 'Fn::ImportValue': 'nobody:Exports' } },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                ],
                {},
                {},
            ),
        ).toEqual([]);
    });

    it('only takes Outputs whose value is a literal — a GetAtt is not a database name', () => {
        expect(
            resolveExports([
                {
                    Outputs: {
                        A: { Export: { Name: 'x:Endpoint' }, Value: { 'Fn::GetAtt': ['D', 'Endpoint.Address'] } },
                    },
                },
            ]),
        ).toEqual({});
    });

    it('de-duplicates and sorts', () => {
        expect(
            discoverDatabases(
                [
                    { Resources: { A: { Type: 'AWS::RDS::DBInstance', Properties: { DBName: 'b' } } } },
                    { Resources: { B: { Type: 'AWS::RDS::DBInstance', Properties: { DBName: 'a' } } } },
                    { Resources: { C: { Type: 'AWS::RDS::DBInstance', Properties: { DBName: 'b' } } } },
                ],
                {},
                {},
            ),
        ).toEqual(['a', 'b']);
    });
});

/**
 * ⛔ The reason this exists. `RecipeService-dev` names its database as `{ Ref: <SSM parameter> }` — a CDK
 * `valueForStringParameter` read of `/kitchensink/dev/recipe/database-name` — and only the recipe SCHEMA stack
 * declares that parameter, with the literal `kitchensink_recipes_dev`. Read without the parameter, the service
 * stack named no database, `local:up` fell back to the server's maintenance database `postgres`, and the recipe
 * container came up healthy against a database with no recipe tables: `/health` answered 200 and every real query
 * failed. The worker (`recipe-workers/.env.development`) meanwhile read `kitchensink_recipes_dev`, so the two halves
 * of one service disagreed about where its data lived.
 */
describe('resolveSsmParameters + discoverDatabases', () => {
    const declaring = {
        Resources: {
            P: {
                Type: 'AWS::SSM::Parameter',
                Properties: {
                    Name: '/kitchensink/dev/recipe/database-name',
                    Type: 'String',
                    Value: 'kitchensink_recipes_dev',
                },
            },
        },
    };
    const reading = (parameter: Record<string, unknown>): unknown => ({
        Parameters: { DbNameParam: parameter },
        Resources: {
            T: {
                Type: 'AWS::ECS::TaskDefinition',
                Properties: {
                    ContainerDefinitions: [{ Environment: [{ Name: 'DB_NAME', Value: { Ref: 'DbNameParam' } }] }],
                },
            },
        },
    });
    const ssmParameter = {
        Type: 'AWS::SSM::Parameter::Value<String>',
        Default: '/kitchensink/dev/recipe/database-name',
    };

    it('maps each declared parameter name to its literal value', () => {
        expect(resolveSsmParameters([declaring])).toEqual({
            '/kitchensink/dev/recipe/database-name': 'kitchensink_recipes_dev',
        });
    });

    it('takes only a literal value — an intrinsic is not a name it can know', () => {
        expect(
            resolveSsmParameters([
                {
                    Resources: {
                        P: {
                            Type: 'AWS::SSM::Parameter',
                            Properties: { Name: '/x', Value: { 'Fn::GetAtt': ['D', 'Endpoint.Address'] } },
                        },
                    },
                },
            ]),
        ).toEqual({});
    });

    it('resolves a database a service reads through an SSM parameter another stack declares', () => {
        const ssm = resolveSsmParameters([declaring]);

        expect(discoverDatabases([reading(ssmParameter)], {}, ssm)).toEqual(['kitchensink_recipes_dev']);
    });

    it('ignores a parameter nothing declares, rather than inventing a database', () => {
        expect(discoverDatabases([reading(ssmParameter)], {}, {})).toEqual([]);
    });

    it('resolves a Ref only through an SSM parameter type — a plain String parameter Default is not a value it was given', () => {
        const ssm = resolveSsmParameters([declaring]);

        expect(
            discoverDatabases([reading({ Type: 'String', Default: '/kitchensink/dev/recipe/database-name' })], {}, ssm),
        ).toEqual([]);
    });

    it('resolves a Ref against the template that holds it, never a parameter another template declares', () => {
        const ssm = resolveSsmParameters([declaring]);
        const elsewhere = { Parameters: { DbNameParam: ssmParameter }, Resources: {} };
        const orphan = {
            Resources: {
                T: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [{ Environment: [{ Name: 'DB_NAME', Value: { Ref: 'DbNameParam' } }] }],
                    },
                },
            },
        };

        expect(discoverDatabases([elsewhere, orphan], {}, ssm)).toEqual([]);
    });
});

/**
 * ⛔ A container's environment was built from the task definition's variable NAMES only, so a value the CDK states
 * outright never reached it: every one became a placeholder. `CLERK_ADMIT_NATIVE_CLIENT: 'true'` (set on every stage
 * by the shared Clerk environment) arrived as `local-placeholder`, `clerk-verify` admitted no azp-less native token,
 * and every request the mobile app made answered `401` — measured on the first device run of `local:maestro`.
 *
 * ⚠️ Only a value EVERY task of the stack states identically. One image serves several tasks (food's api, worker and
 * change-refresh), and the one local container takes the union of their names — so a value only the worker states
 * (`FOOD_WORKER=1`) would turn the API container into a worker.
 */
describe('sharedLiteralEnv', () => {
    const task = (environment: Record<string, unknown>) => ({
        Type: 'AWS::ECS::TaskDefinition',
        Properties: {
            ContainerDefinitions: [
                { Environment: Object.entries(environment).map(([Name, Value]) => ({ Name, Value })) },
            ],
        },
    });
    const invented = new Set(['local-placeholder', 'http://localhost:1']);

    it('takes a literal the stack states', () => {
        expect(sharedLiteralEnv(template({ A: task({ CLERK_ADMIT_NATIVE_CLIENT: 'true' }) }), invented)).toEqual({
            CLERK_ADMIT_NATIVE_CLIENT: 'true',
        });
    });

    it('takes only what every task states identically', () => {
        const env = sharedLiteralEnv(
            template({
                Api: task({ CLERK_ADMIT_NATIVE_CLIENT: 'true', MODE: 'api' }),
                Worker: task({ CLERK_ADMIT_NATIVE_CLIENT: 'true', MODE: 'worker', FOOD_WORKER: '1' }),
            }),
            invented,
        );

        expect(env).toEqual({ CLERK_ADMIT_NATIVE_CLIENT: 'true' });
    });

    it('drops a value the synth invented, and anything that is not a literal', () => {
        expect(
            sharedLiteralEnv(
                template({ A: task({ FOOD_SERVICE_URL: 'http://localhost:1', DB_NAME: { Ref: 'P' } }) }),
                invented,
            ),
        ).toEqual({});
    });

    it('finds nothing in a template with no task definition', () => {
        expect(sharedLiteralEnv(template({}), invented)).toEqual({});
    });
});
