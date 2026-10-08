/**
 * @module runPlan — what a local sandbox must RUN, read out of the synthesised CDK.
 *
 * ⛔ Two things the previous version reported as strings and never acted on: the ADR-0022 migration
 * obligation, and our own services. Both are derivable from the template, and neither is written down here.
 */

/** A resource map, narrowed to what these readers touch. */
interface Template {
    readonly Resources?: Readonly<Record<string, { readonly Type?: unknown; readonly Properties?: unknown }>>;
    readonly Outputs?: Readonly<Record<string, { readonly Value?: unknown }>>;
}

/** The output every migration runner publishes for the pipeline (`runMigrations.sh`), as `<Name>MigrationFunctionName`. */
const RUNNER_OUTPUT = /MigrationFunctionName$/u;

/** The output a catalog seed function publishes for the pipeline (`runSeed.sh`), as `<Name>SeedFunctionName`. */
const SEED_OUTPUT = /SeedFunctionName$/u;

/**
 * The logical ids the stack's outputs name, for outputs whose key matches `pattern`.
 *
 * @param template - The synthesised template.
 * @param pattern - The output-key pattern.
 * @returns The `Ref` targets, in output order. Pure.
 */
function outputTargets(template: unknown, pattern: RegExp): readonly string[] {
    const outputs = (template as Template).Outputs ?? {};

    return Object.entries(outputs).flatMap(([name, output]) => {
        const ref = (output.Value as { Ref?: unknown } | null | undefined)?.Ref;

        return pattern.test(name) && typeof ref === 'string' ? [ref] : [];
    });
}

/** One stack's migration bundle. */
export interface MigrationSet {
    readonly stack: string;
    readonly logicalId: string;
    /** CDK asset hash — the SQL lives at `<outDir>/asset.<hash>/migrations/`. */
    readonly assetHash: string;
}

/**
 * Find the migration bundles a stack ships: the asset of each RUNNER, the function a `*MigrationFunctionName` output
 * names (ADR-0035 puts one in each schema stack).
 *
 * ⚠️ Keyed off the CDK's own asset, not a path in this repo. `Code.S3Key` is `<hash>.zip` and the synth
 * writes the unpacked bundle beside the template as `asset.<hash>/` — so a migration added tomorrow is
 * applied because it is in the bundle CDK built, not because anyone updated a list.
 *
 * ⚠️ Only the runner. Another function's bundle can hold a `migrations/` folder too, left in a build output that is
 * never emptied, and applying it would run SQL no runner ships.
 *
 * @param stack - Stack name, carried so a finding is traceable.
 * @param template - The synthesised template.
 * @returns One entry per asset-backed runner. Pure.
 */
export function discoverMigrations(stack: string, template: unknown): readonly MigrationSet[] {
    const resources = (template as Template).Resources ?? {};

    return outputTargets(template, RUNNER_OUTPUT).flatMap((logicalId) => {
        const resource = resources[logicalId];

        if (resource?.Type !== 'AWS::Lambda::Function') {
            return [];
        }

        const key = (resource.Properties as { Code?: { S3Key?: unknown } } | undefined)?.Code?.S3Key;

        if (typeof key !== 'string' || !key.endsWith('.zip')) {
            return [];
        }

        return [{ stack, logicalId, assetHash: key.replace(/\.zip$/u, '') }];
    });
}

/**
 * Every database that is not migrated by exactly one runner (ADR-0035 gives each database one, in its schema stack).
 *
 * @param databases - Every database the synthesized stacks name.
 * @param migratedBy - For each database, the stacks whose runner applied SQL to it.
 * @returns One message per database with no runner or more than one. Pure.
 */
export function migrationCoverageGaps(
    databases: readonly string[],
    migratedBy: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
    return databases.flatMap((database) => {
        const runners = migratedBy.get(database) ?? [];

        if (runners.length === 1) {
            return [];
        }

        return runners.length === 0
            ? [`${database}: no migration runner`]
            : [`${database}: ${String(runners.length)} migration runners (${runners.join(', ')})`];
    });
}

/**
 * One catalog seed function, as the template declares it.
 *
 * `unbuilt` is a seed output with no usable bundle behind it: the stack's inline placeholder, a handler naming no
 * module, or an output naming something that is not a Lambda. There is nothing to apply, and `local:up` says so.
 */
export type SeedFunction =
    | {
          readonly kind: 'bundled';
          readonly stack: string;
          readonly logicalId: string;
          /** CDK asset hash: the bundle lives at `<outDir>/asset.<hash>/`. */
          readonly assetHash: string;
          /** The module the handler names, relative to the bundle: `lambdas/seed/handler.js`. */
          readonly module: string;
      }
    | { readonly kind: 'unbuilt'; readonly stack: string; readonly logicalId: string };

/**
 * Find the catalog seed functions a stack declares (curated catalog plan U7): the function each `*SeedFunctionName`
 * output names, as migration runners are found by theirs. The module comes from the function's own `Handler`, so
 * nothing here names a path in food-service.
 *
 * @param stack - Stack name, carried so a finding is traceable.
 * @param template - The synthesised template.
 * @returns One entry per seed output. Pure.
 */
export function discoverSeedFunctions(stack: string, template: unknown): readonly SeedFunction[] {
    const resources = (template as Template).Resources ?? {};

    return outputTargets(template, SEED_OUTPUT).map((logicalId): SeedFunction => {
        const resource = resources[logicalId];
        const properties = resource?.Properties as { Code?: { S3Key?: unknown }; Handler?: unknown } | undefined;
        const key = properties?.Code?.S3Key;
        const handler = properties?.Handler;
        const exportAt = typeof handler === 'string' ? handler.lastIndexOf('.') : -1;

        if (
            resource?.Type !== 'AWS::Lambda::Function' ||
            typeof key !== 'string' ||
            !key.endsWith('.zip') ||
            typeof handler !== 'string' ||
            exportAt <= 0
        ) {
            return { kind: 'unbuilt', stack, logicalId };
        }

        return {
            kind: 'bundled',
            stack,
            logicalId,
            assetHash: key.replace(/\.zip$/u, ''),
            module: `${handler.slice(0, exportAt)}.js`,
        };
    });
}

/** One of our own services, as the template declares it. */
export interface ServiceTask {
    readonly stack: string;
    readonly logicalId: string;
    /** The port the container binds, or `undefined` for a worker with no inbound traffic. */
    readonly containerPort: number | undefined;
    /** Environment variable NAMES the container expects, sorted. Values are mostly deploy-time references. */
    readonly envKeys: readonly string[];
}

/**
 * Find the service tasks a stack declares.
 *
 * ⚠️ A task with NO port mapping is reported, not dropped — that is a queue drainer, which still has to run.
 * Dropping it would silently omit the worker and leave a sandbox that accepts writes and never processes
 * them.
 *
 * @param stack - Stack name.
 * @param template - The synthesised template.
 * @returns One entry per task definition. Pure.
 */
export function discoverServiceTasks(stack: string, template: unknown): readonly ServiceTask[] {
    const resources = (template as Template).Resources ?? {};

    return Object.entries(resources).flatMap(([logicalId, resource]) => {
        if (resource.Type !== 'AWS::ECS::TaskDefinition') {
            return [];
        }

        const container = (
            resource.Properties as { ContainerDefinitions?: readonly Record<string, unknown>[] } | undefined
        )?.ContainerDefinitions?.[0];
        const ports = container?.['PortMappings'] as readonly { ContainerPort?: unknown }[] | undefined;
        const port = ports?.[0]?.ContainerPort;
        const environment = (container?.['Environment'] ?? []) as readonly { Name?: unknown }[];

        return [
            {
                stack,
                logicalId,
                containerPort: typeof port === 'number' ? port : undefined,
                envKeys: environment.flatMap((entry) => (typeof entry.Name === 'string' ? [entry.Name] : [])).sort(),
            },
        ];
    });
}

/** A CloudFormation export name mapped to its literal value. */
export type ExportMap = Readonly<Record<string, string>>;

/**
 * Build the export → literal-value map across every synthesised template.
 *
 * ⚠️ LITERALS ONLY. Most exports are `Fn::GetAtt` of something that exists only once deployed (an endpoint
 * address, a security group id) and has no meaning locally. Carrying those forward would let a resolver
 * hand back an object where a caller expected a name.
 *
 * @param templates - Every parsed template.
 * @returns Export name → value, for exports whose value is a plain string. Pure.
 */
export function resolveExports(templates: readonly unknown[]): ExportMap {
    const map: Record<string, string> = Object.create(null) as Record<string, string>;

    for (const template of templates) {
        const outputs = (template as { Outputs?: Record<string, unknown> }).Outputs ?? {};

        for (const output of Object.values(outputs)) {
            const name = (output as { Export?: { Name?: unknown } }).Export?.Name;
            const value = (output as { Value?: unknown }).Value;

            if (typeof name === 'string' && typeof value === 'string') {
                map[name] = value;
            }
        }
    }

    return map;
}

/** SSM parameter name → its literal value, for every `AWS::SSM::Parameter` the templates DECLARE. */
export type SsmParameterMap = Readonly<Record<string, string>>;

/**
 * Every SSM parameter the synthesised CDK declares, by name.
 *
 * The SSM counterpart of {@link resolveExports}: a stack that reads a value with `valueForStringParameter` carries
 * only the parameter's NAME (a template `Parameter` of type `AWS::SSM::Parameter::Value<String>`), and the stack that
 * declares the parameter carries the value.
 *
 * @param templates - Every parsed template.
 * @returns Parameter name → value, for parameters whose name and value are both plain strings. Pure.
 */
export function resolveSsmParameters(templates: readonly unknown[]): SsmParameterMap {
    const map: Record<string, string> = Object.create(null) as Record<string, string>;

    for (const template of templates) {
        const resources = (template as { Resources?: Record<string, unknown> }).Resources ?? {};

        for (const resource of Object.values(resources)) {
            const { Type: type, Properties: properties } = resource as { Type?: unknown; Properties?: unknown };
            const { Name: name, Value: value } = (properties ?? {}) as { Name?: unknown; Value?: unknown };

            if (type === 'AWS::SSM::Parameter' && typeof name === 'string' && typeof value === 'string') {
                map[name] = value;
            }
        }
    }

    return map;
}

/** The template parameter type CDK's `valueForStringParameter` synthesises. */
const SSM_STRING_PARAMETER = 'AWS::SSM::Parameter::Value<String>';

/** Keys whose VALUE names a database. */
const DATABASE_KEY = /(^|_)(DB_NAME|DATABASE_NAME|POSTGRES_DB)$/u;

/** A plausible PostgreSQL identifier — guards against sweeping up an unrelated string. */
const DATABASE_NAME = /^[a-z_][a-z0-9_]*$/iu;

/**
 * Every logical database the synthesised CDK names.
 *
 * ⛔ RESOLVES `Fn::ImportValue`, and that is not a nicety. `IdentityService` states its database as an
 * import of `kitchensink-data-{stage}:DatabaseName`; the global Data stack declares the literal. Without
 * resolution the identity stack appears to name NO database, its migrations are skipped, and the sandbox
 * comes up with an empty identity schema that fails on the first sign-in — measured exactly once, at 44
 * files applied to food and recipe and 0 to identity.
 *
 * @param templates - Every parsed template.
 * @param exports_ - The export map from {@link resolveExports}.
 * @param ssmParameters - The declared SSM parameters from {@link resolveSsmParameters}, for a database a stack reads
 *   with `valueForStringParameter` (recipe-service: `/kitchensink/{stage}/recipe/database-name`).
 * @returns Sorted, de-duplicated database names. Pure.
 */
export function discoverDatabases(
    templates: readonly unknown[],
    exports_: ExportMap,
    ssmParameters: SsmParameterMap,
): readonly string[] {
    const names = new Set<string>();

    const literal = (value: unknown, parameters: Readonly<Record<string, unknown>>): string | undefined => {
        if (typeof value === 'string') {
            return value;
        }

        const imported = (value as { 'Fn::ImportValue'?: unknown } | null)?.['Fn::ImportValue'];

        if (typeof imported === 'string') {
            return exports_[imported];
        }

        // ⚠️ A `Ref` resolves against the template that HOLDS it — a logical id means nothing in another template —
        // and only through an SSM parameter type, whose `Default` is a parameter NAME rather than a value.
        const ref = (value as { Ref?: unknown } | null)?.Ref;
        const parameter = typeof ref === 'string' && Object.hasOwn(parameters, ref) ? parameters[ref] : undefined;
        const { Type: type, Default: path } = (parameter ?? {}) as { Type?: unknown; Default?: unknown };

        return type === SSM_STRING_PARAMETER && typeof path === 'string' ? ssmParameters[path] : undefined;
    };

    const walkTemplate = (template: unknown): void => {
        const parameters = (template as { Parameters?: Record<string, unknown> } | null)?.Parameters ?? {};

        walk(template, parameters);
    };

    const walk = (node: unknown, parameters: Readonly<Record<string, unknown>>): void => {
        if (Array.isArray(node)) {
            node.forEach((child) => walk(child, parameters));

            return;
        }

        if (node === null || typeof node !== 'object') {
            return;
        }

        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key === 'DBName') {
                const name = literal(value, parameters);

                if (name !== undefined && DATABASE_NAME.test(name)) {
                    names.add(name);
                }
            }

            // A task definition's `Environment: [{ Name, Value }]`.
            if (key === 'Name' && typeof value === 'string' && DATABASE_KEY.test(value)) {
                const name = literal((node as { Value?: unknown }).Value, parameters);

                if (name !== undefined && DATABASE_NAME.test(name)) {
                    names.add(name);
                }
            }

            // A Lambda's `Environment: { Variables: { KEY: value } }` — how a schema stack's runner names its
            // database (ADR-0035).
            if (key === 'Variables' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
                for (const [variable, raw] of Object.entries(value as Record<string, unknown>)) {
                    const name = DATABASE_KEY.test(variable) ? literal(raw, parameters) : undefined;

                    if (name !== undefined && DATABASE_NAME.test(name)) {
                        names.add(name);
                    }
                }
            }

            walk(value, parameters);
        }
    };

    templates.forEach(walkTemplate);

    return [...names].sort();
}

/**
 * The environment values a stack's task definitions state as LITERALS — and agree on.
 *
 * ⛔ Only a value every task definition of the stack states identically: one image serves several tasks (food's api,
 * worker and change-refresh), and the one local container takes the union of their variable names, so a value only
 * the worker states (`FOOD_WORKER=1`) would turn the API container into a worker. A value the local synth invented
 * (`synthEnvFor`'s placeholders) is not configuration and is dropped.
 *
 * @param template - The synthesised template.
 * @param inventedValues - Every placeholder value the local synth supplied.
 * @returns Name → value. Pure.
 */
export function sharedLiteralEnv(
    template: unknown,
    inventedValues: ReadonlySet<string>,
): Readonly<Record<string, string>> {
    const resources = Object.values(
        (template as { Resources?: Record<string, { Type?: unknown; Properties?: unknown }> } | null)?.Resources ?? {},
    );
    const perTask = resources
        .filter((resource) => resource.Type === 'AWS::ECS::TaskDefinition')
        .map((resource) => {
            const containers =
                (resource.Properties as { ContainerDefinitions?: readonly Record<string, unknown>[] } | undefined)
                    ?.ContainerDefinitions ?? [];
            const literals = new Map<string, string>();

            for (const container of containers) {
                for (const entry of (container['Environment'] ?? []) as readonly {
                    Name?: unknown;
                    Value?: unknown;
                }[]) {
                    if (typeof entry.Name === 'string' && typeof entry.Value === 'string') {
                        literals.set(entry.Name, entry.Value);
                    }
                }
            }

            return literals;
        });
    const [first, ...rest] = perTask;
    const shared: Record<string, string> = Object.create(null) as Record<string, string>;

    for (const [name, value] of first ?? new Map<string, string>()) {
        if (!inventedValues.has(value) && rest.every((literals) => literals.get(name) === value)) {
            shared[name] = value;
        }
    }

    return { ...shared };
}
