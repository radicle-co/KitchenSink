/**
 * @module secretRefs — the SECRETS a container needs, read out of the synthesised CDK.
 *
 * A value the CDK considers sensitive never appears in `ContainerDefinitions[].Environment`; ECS injects it
 * from Secrets Manager at task start, and the template carries only a reference under `Secrets`. Reading
 * `Environment` alone therefore produces a container missing exactly the variables a service is most likely
 * to REQUIRE — `food-service` crash-looped on its own zod schema for want of `USDA_API_KEY`.
 *
 * ⛔ NOTHING IS ENUMERATED. The secret names come from the template, so a secret added to a task definition
 * tomorrow is supplied locally the same day — the rule the rest of this package follows.
 *
 * Parsing is deliberately separate from fetching: which-secret-and-which-key is pure and exhaustively
 * testable, while calling AWS is neither.
 */

/** One secret a container expects, resolved as far as the template alone allows. */
export interface SecretRef {
    /** The environment variable name the container reads. */
    readonly name: string;
    /** The Secrets Manager secret id (its name, not its full ARN). */
    readonly secretId: string;
    /** The key to read inside a JSON secret, or `undefined` for a whole-string secret. */
    readonly jsonKey: string | undefined;
}

/** Everything after `:secret:` in a Secrets Manager ARN. */
const SECRET_ARN_TAIL = /:secretsmanager:[^:]*:[^:]*:secret:(.+)$/u;

/**
 * Flatten the literal parts of a `ValueFrom`, or answer `undefined` if any part is a deploy-time reference.
 *
 * ⚠️ `{ Ref: 'AWS::Partition' }` is the ONE non-literal that still yields a literal answer — it is `aws` in
 * every partition this repo deploys to, and it sits before `:secret:` so it cannot affect the id we read.
 * Every other intrinsic (notably `Fn::ImportValue`) means the ARN does not exist until a stack is deployed,
 * and there is nothing here to resolve.
 */
function literalOf(valueFrom: unknown): string | undefined {
    if (typeof valueFrom === 'string') {
        return valueFrom;
    }

    const join = (valueFrom as { 'Fn::Join'?: unknown } | undefined)?.['Fn::Join'];

    if (!Array.isArray(join) || join.length !== 2 || !Array.isArray(join[1])) {
        return undefined;
    }

    const parts: string[] = [];

    for (const part of join[1] as readonly unknown[]) {
        if (typeof part === 'string') {
            parts.push(part);
            continue;
        }

        if ((part as { Ref?: unknown } | undefined)?.Ref === 'AWS::Partition') {
            parts.push('aws');
            continue;
        }

        return undefined;
    }

    return parts.join('');
}

/**
 * Read one `Secrets[].ValueFrom` into the secret it names.
 *
 * ECS spells a JSON key as a four-field suffix on the ARN — `<id>:<key>:<versionStage>:<versionId>` — with
 * the last two normally empty. A whole-string secret carries no suffix at all.
 *
 * @param valueFrom - The template's `ValueFrom`, in any shape CDK emits.
 * @returns The secret id and optional JSON key, or `undefined` when the reference is not a literal. Pure.
 */
export function parseSecretRef(valueFrom: unknown): Omit<SecretRef, 'name'> | undefined {
    const literal = literalOf(valueFrom);
    const tail = literal === undefined ? undefined : SECRET_ARN_TAIL.exec(literal)?.[1];

    if (tail === undefined) {
        return undefined;
    }

    // ⚠️ Counted from the RIGHT. Splitting from the left would mis-read a secret id that itself contained a
    // colon, and the four-field suffix is positional from the end.
    const fields = tail.split(':');

    if (fields.length >= 4) {
        const jsonKey = fields[fields.length - 3];

        return {
            secretId: fields.slice(0, fields.length - 3).join(':'),
            jsonKey: jsonKey === undefined || jsonKey === '' ? undefined : jsonKey,
        };
    }

    return { secretId: tail, jsonKey: undefined };
}

/** The minimum of a CloudFormation template this module reads. */
interface Template {
    readonly Resources?: Record<string, { Type?: string; Properties?: Record<string, unknown> }>;
}

/**
 * Find every resolvable secret a template's task definitions declare.
 *
 * ⚠️ EVERY container, not just the first. `discoverServiceTasks` reads `ContainerDefinitions[0]` because a
 * task here has one app container; a secret missed because it sat on a sidecar would be invisible in the
 * same silent way the whole `Secrets` block was.
 *
 * @param template - A synthesised template.
 * @returns One entry per distinct (name, secretId, jsonKey), sorted by name. Pure.
 */
export function secretRefsOf(template: unknown): readonly SecretRef[] {
    const resources = (template as Template | undefined)?.Resources ?? {};
    const seen = new Map<string, SecretRef>();

    for (const resource of Object.values(resources)) {
        if (resource.Type !== 'AWS::ECS::TaskDefinition') {
            continue;
        }

        const containers = (resource.Properties?.['ContainerDefinitions'] ?? []) as readonly Record<string, unknown>[];

        for (const container of containers) {
            const secrets = (container['Secrets'] ?? []) as readonly { Name?: unknown; ValueFrom?: unknown }[];

            for (const secret of secrets) {
                const parsed = parseSecretRef(secret.ValueFrom);

                if (typeof secret.Name !== 'string' || parsed === undefined) {
                    continue;
                }

                const ref = { name: secret.Name, ...parsed };

                seen.set(`${ref.name} ${ref.secretId} ${ref.jsonKey ?? ''}`, ref);
            }
        }
    }

    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One deploy-time SSM lookup a container's environment refers to. */
export interface SsmRef {
    /** The environment variable name the container reads. */
    readonly name: string;
    /** The SSM parameter path the CDK resolves at deploy. */
    readonly parameterPath: string;
}

/**
 * Find every environment variable whose value is an SSM parameter lookup.
 *
 * `ssm.StringParameter.valueForStringParameter` emits a CloudFormation Parameter of type
 * `AWS::SSM::Parameter::Value<String>` whose `Default` is the parameter path, and puts a `Ref` to it in the
 * container environment. So unlike a secret the NAME is present — but the value resolves only at deploy, and
 * locally the variable was simply omitted. recipe-service REQUIRES `CLERK_JWT_KEY` and refused to boot.
 *
 * ⚠️ The discriminator is the REFERENCE, not the parameter type. `BootstrapVersion` is an SSM-typed
 * parameter too and is not container configuration; only a parameter an environment entry actually points at
 * is one this reads.
 *
 * @param template - A synthesised template.
 * @returns One entry per distinct (name, path), sorted by name. Pure.
 */
export function ssmRefsOf(template: unknown): readonly SsmRef[] {
    const parsed = template as
        | { Parameters?: Record<string, { Type?: string; Default?: unknown }>; Resources?: Template['Resources'] }
        | undefined;
    const parameters = parsed?.Parameters ?? {};
    const resources = parsed?.Resources ?? {};
    const seen = new Map<string, SsmRef>();

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

                const parameter = parameters[ref];

                if (!String(parameter?.Type ?? '').startsWith('AWS::SSM::Parameter::Value')) {
                    continue;
                }

                if (typeof parameter?.Default !== 'string') {
                    continue;
                }

                seen.set(`${entry.Name} ${parameter.Default}`, { name: entry.Name, parameterPath: parameter.Default });
            }
        }
    }

    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
