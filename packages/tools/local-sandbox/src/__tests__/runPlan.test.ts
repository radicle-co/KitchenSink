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

import { discoverDatabases, discoverMigrations, discoverServiceTasks, resolveExports } from '../runPlan.js';

const template = (resources: Record<string, unknown>): unknown => ({ Resources: resources });

describe('discoverMigrations', () => {
    it('finds the migration lambda by its asset, and carries the hash the SQL lives under', () => {
        const found = discoverMigrations(
            'FoodService-dev',
            template({
                FoodMigrationFunction: {
                    Type: 'AWS::Lambda::Function',
                    Properties: { Code: { S3Key: 'abc123.zip' } },
                },
            }),
        );

        expect(found).toEqual([{ stack: 'FoodService-dev', logicalId: 'FoodMigrationFunction', assetHash: 'abc123' }]);
    });

    it('ignores lambdas with no asset key — nothing to apply', () => {
        expect(discoverMigrations('S', template({ F: { Type: 'AWS::Lambda::Function', Properties: {} } }))).toEqual([]);
    });

    it('ignores inline-code lambdas, which carry no migration bundle', () => {
        expect(
            discoverMigrations(
                'S',
                template({ F: { Type: 'AWS::Lambda::Function', Properties: { Code: { ZipFile: 'exports.h=1' } } } }),
            ),
        ).toEqual([]);
    });

    it('is not fooled by a non-lambda resource that happens to have Code', () => {
        expect(
            discoverMigrations(
                'S',
                template({ X: { Type: 'AWS::S3::Bucket', Properties: { Code: { S3Key: 'a.zip' } } } }),
            ),
        ).toEqual([]);
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
            ),
        ).toEqual(['kitchensink_identity']);
    });

    it('still finds a plainly-stated database name', () => {
        expect(
            discoverDatabases(
                [{ Resources: { D: { Type: 'AWS::RDS::DBInstance', Properties: { DBName: 'kitchensink_food' } } } }],
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
            ),
        ).toEqual(['a', 'b']);
    });
});
