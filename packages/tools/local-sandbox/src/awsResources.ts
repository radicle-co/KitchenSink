/**
 * @module awsResources — the AWS resources a local run must CREATE, derived from the synthesised CDK.
 *
 * ⛔ LocalStack was being STARTED and never POPULATED. Every declared bucket, queue, table and topic was
 * absent, so services ran with `S3_BUCKET_PHOTOS=local-placeholder` and `ACCOUNT_ERASURE_QUEUE_URL=
 * http://localhost:1`. Nothing failed at startup — the endpoint and credentials were fine, and a real SDK
 * call from inside a container reached LocalStack and returned zero buckets — so the first sign of trouble
 * would have been a photo upload 500ing at run time.
 *
 * ⛔ NOTHING IS ENUMERATED. The inventory is the templates.
 */

/** The CloudFormation types a local run can stand up, and the property each carries its name in. */
const NAME_PROPERTY: Readonly<Record<string, string>> = Object.freeze({
    'AWS::S3::Bucket': 'BucketName',
    'AWS::SQS::Queue': 'QueueName',
    'AWS::SNS::Topic': 'TopicName',
    'AWS::DynamoDB::Table': 'TableName',
    'AWS::DynamoDB::GlobalTable': 'TableName',
    'AWS::Events::EventBus': 'Name',
    'AWS::SSM::Parameter': 'Name',
    'AWS::SecretsManager::Secret': 'Name',
});

/** Where the local emulator lives, and who it thinks we are. */
export interface LocalStackTarget {
    readonly endpoint: string;
    readonly region: string;
    readonly account: string;
}

/** One resource to create locally. */
export interface CreatableResource {
    readonly stack: string;
    readonly logicalId: string;
    readonly type: string;
    /** The name to create it under — the declared one, or a derived one that is stable across runs. */
    readonly name: string;
    /** The resource's own properties, for the few types that need more than a name. */
    readonly properties: Readonly<Record<string, unknown>>;
}

/** The minimum of a template this module reads. */
interface Template {
    readonly Resources?: Record<string, { Type?: string; Properties?: Record<string, unknown> }>;
    readonly Outputs?: Record<string, { Value?: unknown; Export?: { Name?: unknown } }>;
}

/**
 * A name for a resource the CDK left to CloudFormation to generate.
 *
 * ⚠️ It must be STABLE across runs — the container env is wired from it, so a name that changed between two
 * `local:up` invocations would silently point the services at buckets that no longer exist. Derived from the
 * stack and logical id, which are themselves stable, and lowercased because S3 rejects uppercase.
 */
function derivedName(stack: string, logicalId: string): string {
    return `${stack}-${logicalId}`
        .replace(/[^A-Za-z0-9-]/gu, '-')
        .replace(/-+/gu, '-')
        .replace(/^-|-$/gu, '')
        .toLowerCase();
}

/**
 * The resources in one template that a local run can create.
 *
 * @param stack - The stack name, used to derive a stable name where the template declares none.
 * @param template - The synthesised template.
 * @returns One entry per creatable resource, in template order. Pure.
 */
export function creatableResources(stack: string, template: unknown): readonly CreatableResource[] {
    const resources = (template as Template | undefined)?.Resources ?? {};

    return Object.entries(resources).flatMap(([logicalId, resource]) => {
        const type = resource.Type;

        if (type === undefined || !(type in NAME_PROPERTY)) {
            return [];
        }

        const properties = resource.Properties ?? {};
        const declared = properties[NAME_PROPERTY[type] as string];

        return [
            {
                stack,
                logicalId,
                type,
                name: typeof declared === 'string' ? declared : derivedName(stack, logicalId),
                properties,
            },
        ];
    });
}

/**
 * What `Ref` yields for a resource — which is NOT the same thing for every type.
 *
 * ⛔ `Ref` on a bucket is its NAME, on a queue its URL, on a topic its ARN. Treating it as "the name"
 * everywhere would hand `ACCOUNT_ERASURE_QUEUE_URL` a bare queue name, and the SDK would then fail on a
 * malformed endpoint rather than on anything that points at the mistake.
 *
 * @param resource - The type and name.
 * @param target - The local emulator's endpoint, region and account.
 * @returns The value a `Ref` to this resource resolves to. Pure.
 */
export function refValueOf(
    resource: { readonly type: string; readonly name: string },
    target: LocalStackTarget,
): string {
    switch (resource.type) {
        case 'AWS::SQS::Queue':
            return `${target.endpoint}/${target.account}/${resource.name}`;
        case 'AWS::SNS::Topic':
            return `arn:aws:sns:${target.region}:${target.account}:${resource.name}`;
        case 'AWS::SecretsManager::Secret':
            return `arn:aws:secretsmanager:${target.region}:${target.account}:secret:${resource.name}`;
        default:
            // Buckets, tables, buses and SSM parameters all `Ref` to their own name.
            return resource.name;
    }
}

/** The ARN of a resource, for the `Fn::GetAtt … Arn` exports. */
function arnOf(resource: { readonly type: string; readonly name: string }, target: LocalStackTarget): string {
    switch (resource.type) {
        case 'AWS::S3::Bucket':
            return `arn:aws:s3:::${resource.name}`;
        case 'AWS::SQS::Queue':
            return `arn:aws:sqs:${target.region}:${target.account}:${resource.name}`;
        case 'AWS::SNS::Topic':
            return `arn:aws:sns:${target.region}:${target.account}:${resource.name}`;
        case 'AWS::DynamoDB::Table':
        case 'AWS::DynamoDB::GlobalTable':
            return `arn:aws:dynamodb:${target.region}:${target.account}:table/${resource.name}`;
        case 'AWS::Events::EventBus':
            return `arn:aws:events:${target.region}:${target.account}:event-bus/${resource.name}`;
        default:
            return `arn:aws:secretsmanager:${target.region}:${target.account}:secret:${resource.name}`;
    }
}

/**
 * Build the export → local-value map.
 *
 * A container does not name a bucket directly; it holds `Fn::ImportValue` of another stack's export, and
 * that export is a `Ref` or a `Fn::GetAtt … Arn` of the resource. Resolving those against the names we are
 * about to create is what replaces `local-placeholder` with something real.
 *
 * @param templates - Every synthesised template, with the stack name it came from.
 * @param target - The local emulator's endpoint, region and account.
 * @returns Export name → the value it resolves to locally. Pure.
 */
export function localExportMap(
    templates: readonly { readonly stack: string; readonly template: unknown }[],
    target: LocalStackTarget,
): Readonly<Record<string, string>> {
    const byLogicalId = new Map<string, CreatableResource>();

    for (const entry of templates) {
        for (const resource of creatableResources(entry.stack, entry.template)) {
            byLogicalId.set(resource.logicalId, resource);
        }
    }

    const map: Record<string, string> = {};

    for (const entry of templates) {
        const outputs = (entry.template as Template | undefined)?.Outputs ?? {};

        for (const output of Object.values(outputs)) {
            const exportName = output.Export?.Name;

            if (typeof exportName !== 'string') {
                continue;
            }

            const value = output.Value as { Ref?: unknown; 'Fn::GetAtt'?: unknown } | undefined;
            const ref = value?.Ref;
            const getAtt = value?.['Fn::GetAtt'];

            if (typeof ref === 'string') {
                const resource = byLogicalId.get(ref);

                if (resource !== undefined) {
                    map[exportName] = refValueOf(resource, target);
                }

                continue;
            }

            if (Array.isArray(getAtt) && typeof getAtt[0] === 'string') {
                const resource = byLogicalId.get(getAtt[0]);

                if (resource !== undefined && getAtt[1] === 'Arn') {
                    map[exportName] = arnOf(resource, target);
                }
            }
        }
    }

    return map;
}

/** One container environment variable whose value is another stack's export. */
export interface ImportRef {
    /** The environment variable name. */
    readonly name: string;
    /** The CloudFormation export it imports. */
    readonly exportName: string;
}

/**
 * Find every container environment variable whose value is an `Fn::ImportValue`.
 *
 * This is the last link: `localExportMap` says what an export resolves to locally, and this says which
 * variable wanted it. Without it the resources would exist in LocalStack and the services would still be
 * reading `local-placeholder`, which is the same outcome as not creating them.
 *
 * @param template - A synthesised template.
 * @returns One entry per distinct (name, export), sorted by name. Pure.
 */
export function importRefsOf(template: unknown): readonly ImportRef[] {
    const resources = (template as Template | undefined)?.Resources ?? {};
    const seen = new Map<string, ImportRef>();

    for (const resource of Object.values(resources)) {
        if (resource.Type !== 'AWS::ECS::TaskDefinition') {
            continue;
        }

        const containers = (resource.Properties?.['ContainerDefinitions'] ?? []) as readonly Record<string, unknown>[];

        for (const container of containers) {
            const environment = (container['Environment'] ?? []) as readonly { Name?: unknown; Value?: unknown }[];

            for (const entry of environment) {
                const imported = (entry.Value as { 'Fn::ImportValue'?: unknown } | undefined)?.['Fn::ImportValue'];

                if (typeof entry.Name === 'string' && typeof imported === 'string') {
                    seen.set(`${entry.Name} ${imported}`, { name: entry.Name, exportName: imported });
                }
            }
        }
    }

    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The stack part of an export name with its stage token removed — `kitchensink-data-dev` → `kitchensink-data`.
 */
function withoutStage(stackPart: string): string {
    return stackPart.replace(/-[^-]+$/u, '');
}

/**
 * Resolve one `Fn::ImportValue` name against the local export map, tolerating a differing stage token.
 *
 * ⛔ LOCALLY THERE IS ONE STACK PER LOGICAL STACK, whatever stage token each app synthesised under, so the
 * stage in an export name carries no information. Measured: the global Data stack synthesises as `dev` and
 * exports `kitchensink-data-dev:MediaBucketName`, while recipe-service synthesises with `baseStage=sandbox`
 * and imports `kitchensink-data-sandbox:MediaBucketName`. They name the SAME bucket, and an exact match
 * finds nothing — which left `S3_BUCKET_PHOTOS` on `local-placeholder` even though the bucket had just been
 * created, while identity resolved only because it happened to share the stage token.
 *
 * ⚠️ Exact match wins. Falling straight to the relaxed match would collide two genuinely different exports
 * the moment a stack legitimately carries per-stage variants.
 *
 * @param exportName - The name the container imports.
 * @param map - Export name → local value, from {@link localExportMap}.
 * @returns The value, or `undefined` when nothing matches. Pure.
 */
export function resolveImport(exportName: string, map: Readonly<Record<string, string>>): string | undefined {
    const exact = map[exportName];

    if (exact !== undefined) {
        return exact;
    }

    const colon = exportName.indexOf(':');

    if (colon < 0) {
        return undefined;
    }

    const wantedStack = withoutStage(exportName.slice(0, colon));
    const wantedKey = exportName.slice(colon + 1);

    for (const [candidate, value] of Object.entries(map)) {
        const candidateColon = candidate.indexOf(':');

        if (candidateColon < 0) {
            continue;
        }

        if (
            candidate.slice(candidateColon + 1) === wantedKey &&
            withoutStage(candidate.slice(0, candidateColon)) === wantedStack
        ) {
            return value;
        }
    }

    return undefined;
}

/**
 * Resolve container environment variables that `Ref` a resource in their OWN stack.
 *
 * ⚠️ {@link importRefsOf} covers `Fn::ImportValue` — another stack's resource, reached through an export. A
 * stack that OWNS the resource references it directly, and those never pass through an export at all.
 * Measured: `FOOD_EVENT_BUS_NAME` and `MESSAGE_TABLE_NAME` were still `local-placeholder` after the import
 * path worked, for exactly this reason.
 *
 * ⛔ Not to be confused with a `Ref` to a template PARAMETER, which `ssmRefsOf` handles. The discriminator
 * here is whether the logical id names a resource this run creates.
 *
 * @param stack - The stack name, for deriving names the template left to CloudFormation.
 * @param template - The synthesised template.
 * @param target - The local emulator's endpoint, region and account.
 * @returns Variable name → local value. Pure.
 */
export function ownRefsOf(
    stack: string,
    template: unknown,
    target: LocalStackTarget,
): Readonly<Record<string, string>> {
    const byLogicalId = new Map(creatableResources(stack, template).map((r) => [r.logicalId, r]));
    const resources = (template as Template | undefined)?.Resources ?? {};
    const resolved: Record<string, string> = {};

    for (const resource of Object.values(resources)) {
        if (resource.Type !== 'AWS::ECS::TaskDefinition') {
            continue;
        }

        const containers = (resource.Properties?.['ContainerDefinitions'] ?? []) as readonly Record<string, unknown>[];

        for (const container of containers) {
            const environment = (container['Environment'] ?? []) as readonly { Name?: unknown; Value?: unknown }[];

            for (const entry of environment) {
                const ref = (entry.Value as { Ref?: unknown } | undefined)?.Ref;

                if (typeof entry.Name !== 'string' || typeof ref !== 'string') {
                    continue;
                }

                const target_ = byLogicalId.get(ref);

                if (target_ !== undefined) {
                    resolved[entry.Name] = refValueOf(target_, target);
                }
            }
        }
    }

    return resolved;
}

/**
 * Resolve SSM parameter values that are a `Ref` to another resource.
 *
 * ⛔ `RecipeWorkers` publishes its queue URLs as SSM parameters whose `Value` is `{ Ref: <queue> }`, not a
 * string. Creating those with a literal fallback wrote `local-placeholder` INTO SSM — a parameter that
 * exists and is wrong, which reads as configured and is worse than one that is missing.
 *
 * @param resources - Everything this run will create.
 * @param target - The local emulator's endpoint, region and account.
 * @returns The same list, with resolvable parameter values replaced by literals. Pure.
 */
export function resolveParameterValues(
    resources: readonly CreatableResource[],
    target: LocalStackTarget,
): readonly CreatableResource[] {
    const byLogicalId = new Map(resources.map((resource) => [resource.logicalId, resource]));

    return resources.map((resource) => {
        if (resource.type !== 'AWS::SSM::Parameter') {
            return resource;
        }

        const ref = (resource.properties['Value'] as { Ref?: unknown } | undefined)?.Ref;
        const referenced = typeof ref === 'string' ? byLogicalId.get(ref) : undefined;

        if (referenced === undefined) {
            return resource;
        }

        return { ...resource, properties: { ...resource.properties, Value: refValueOf(referenced, target) } };
    });
}
