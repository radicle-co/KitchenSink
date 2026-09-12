/**
 * @module runPlan — what a local sandbox must RUN, read out of the synthesised CDK.
 *
 * ⛔ Two things the previous version reported as strings and never acted on: the ADR-0022 migration
 * obligation, and our own services. Both are derivable from the template, and neither is written down here.
 */

/** A resource map, narrowed to what these readers touch. */
interface Template {
    readonly Resources?: Readonly<Record<string, { readonly Type?: unknown; readonly Properties?: unknown }>>;
}

/** One stack's migration bundle. */
export interface MigrationSet {
    readonly stack: string;
    readonly logicalId: string;
    /** CDK asset hash — the SQL lives at `<outDir>/asset.<hash>/migrations/`. */
    readonly assetHash: string;
}

/**
 * Find the migration bundles a stack ships.
 *
 * ⚠️ Keyed off the CDK's own asset, not a path in this repo. `Code.S3Key` is `<hash>.zip` and the synth
 * writes the unpacked bundle beside the template as `asset.<hash>/` — so a migration added tomorrow is
 * applied because it is in the bundle CDK built, not because anyone updated a list.
 *
 * @param stack - Stack name, carried so a finding is traceable.
 * @param template - The synthesised template.
 * @returns One entry per asset-backed Lambda. Pure.
 */
export function discoverMigrations(stack: string, template: unknown): readonly MigrationSet[] {
    const resources = (template as Template).Resources ?? {};

    return Object.entries(resources).flatMap(([logicalId, resource]) => {
        if (resource.Type !== 'AWS::Lambda::Function') {
            return [];
        }

        const key = (resource.Properties as { Code?: { S3Key?: unknown } } | undefined)?.Code?.S3Key;

        if (typeof key !== 'string' || !key.endsWith('.zip')) {
            return [];
        }

        return [{ stack, logicalId, assetHash: key.replace(/\.zip$/u, '') }];
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
    const map: Record<string, string> = {};

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
 * @returns Sorted, de-duplicated database names. Pure.
 */
export function discoverDatabases(templates: readonly unknown[], exports_: ExportMap): readonly string[] {
    const names = new Set<string>();

    const literal = (value: unknown): string | undefined => {
        if (typeof value === 'string') {
            return value;
        }

        const imported = (value as { 'Fn::ImportValue'?: unknown } | null)?.['Fn::ImportValue'];

        return typeof imported === 'string' ? exports_[imported] : undefined;
    };

    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walk);

            return;
        }

        if (node === null || typeof node !== 'object') {
            return;
        }

        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key === 'DBName') {
                const name = literal(value);

                if (name !== undefined && DATABASE_NAME.test(name)) {
                    names.add(name);
                }
            }

            // A task definition's `Environment: [{ Name, Value }]`.
            if (key === 'Name' && typeof value === 'string' && DATABASE_KEY.test(value)) {
                const name = literal((node as { Value?: unknown }).Value);

                if (name !== undefined && DATABASE_NAME.test(name)) {
                    names.add(name);
                }
            }

            walk(value);
        }
    };

    templates.forEach(walk);

    return [...names].sort();
}
