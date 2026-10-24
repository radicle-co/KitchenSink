/**
 * @module tierNames — the ONE authority for how the two stage tiers are kept out of each other's resource NAMES.
 *
 * The nonprod policies deny every `*-prod*` name and the prod policies deny every sandbox or preview name. The first
 * version wrote that as one resource per name form with a wildcard in the ARN's SERVICE field
 * (`arn:aws:*:*:*:*kitchensink-*-prod*`), and IAM refused it at CreatePolicy: "Resource vendor must be fully
 * qualified and cannot contain regexes". An ARN's service must be a concrete word.
 *
 * ## The redesign
 *
 * A Deny now lists one ARN per SERVICE, and only for services whose ARNs can carry a name:
 *
 * - **Derived from the Allows.** A Deny removes access that something grants. A service nothing in the policy set
 *   allows needs no line; a service whose ARNs hold only generated ids (`ec2`, `acm`, ...) cannot contain a tier
 *   token, so a name pattern could never match it. `tierNames.test.ts` reads every rendered policy set and fails when
 *   a service appears in an Allow and is neither covered here nor listed there as id-only, with the reason.
 * - **Name forms per service.** Every service gets the flat form (`*kitchensink-*-prod*`); the three whose names are
 *   also slash-separated paths (`ssm` parameters, `secretsmanager` secrets, `logs` groups) get the path forms too.
 * - **Shape per service.** The region and account fields follow the service: an S3 bucket has neither, IAM and
 *   CloudFront have an account but no region, everything else has both (`*` for both, since a Deny that over-matches
 *   a region or account only removes more access). `arnGrammar.test.ts` holds each against the Service
 *   Authorization Reference.
 *
 * Both the permissions boundary and the execution policy call this module, so the knowledge "what a production name
 * looks like" lives once.
 *
 * @pattern Specification / policy module — the name rule is data (patterns x services), rendered into Deny resources
 */

import type { Statement } from './policyDocument.js';

/** Which side of the tier line a Deny protects. */
export type TierSide = 'production' | 'nonproduction';

/** How many of the ARN's region and account fields a service fills. */
type ArnShape = 'regional' | 'accountOnly' | 'bucket';

/** The services whose ARNs can carry a resource name, and the shape of their ARNs. */
const SERVICE_SHAPES = {
    cloudformation: 'regional',
    cloudwatch: 'regional',
    dynamodb: 'regional',
    ecr: 'regional',
    ecs: 'regional',
    elasticloadbalancing: 'regional',
    events: 'regional',
    iam: 'accountOnly',
    kms: 'regional',
    lambda: 'regional',
    logs: 'regional',
    rds: 'regional',
    s3: 'bucket',
    scheduler: 'regional',
    secretsmanager: 'regional',
    sns: 'regional',
    sqs: 'regional',
    ssm: 'regional',
    states: 'regional',
} as const satisfies Record<string, ArnShape>;

/** A service the tier Denies can cover. */
export type TierService = keyof typeof SERVICE_SHAPES;

/**
 * How much of a name the patterns anchor on.
 *
 * - `anchored` — `*kitchensink-*-prod*`: only KitchenSink names. For the execution policy, whose Allows reach names
 *   that do not start with `kitchensink` and which has room in its guard part.
 * - `compact` — `*-prod*`: the stage token alone. For the permissions boundary, which must fit ONE managed policy and
 *   whose Allows already name only `kitchensink` resources, so the anchor adds characters and no protection. A
 *   compact pattern is a superset of its anchored form (it also catches `kitchensink-prod-x`), and over-matches only
 *   names the boundary does not allow in the first place.
 */
export type TierNameForm = 'anchored' | 'compact';

const FLAT_FORMS: Readonly<Record<TierNameForm, Readonly<Record<TierSide, readonly string[]>>>> = {
    anchored: {
        production: ['*kitchensink-*-prod*'],
        nonproduction: ['*kitchensink-*-sandbox*', '*kitchensink-*-pr-*'],
    },
    compact: { production: ['*-prod*'], nonproduction: ['*-sandbox*', '*-pr-*'] },
};

const PATH_FORMS: Readonly<Record<TierNameForm, Readonly<Record<TierSide, readonly string[]>>>> = {
    anchored: {
        production: ['*kitchensink/*prod/*', '*kitchensink/*prod'],
        nonproduction: ['*kitchensink/sandbox*', '*kitchensink/*/sandbox*', '*kitchensink/pr-*', '*kitchensink/*/pr-*'],
    },
    compact: { production: ['*/prod/*', '*/prod'], nonproduction: ['*/sandbox*', '*/pr-*'] },
};

/** Services whose resource part is a bare name with no type segment (`kitchensink-queue`, `kitchensink-bucket/key`). */
const BARE_NAME_SERVICES: ReadonlySet<TierService> = new Set<TierService>(['s3', 'sns', 'sqs']);

/**
 * Resource types of services the policies allow on `*`, so no Allow ARN names them: the Deny still has to, because
 * their ARNs carry names (`loadbalancer/app/kitchensink-x-prod/<id>`, `alias/kitchensink-x-prod`).
 */
const STATIC_TYPES: Readonly<Partial<Record<TierService, readonly string[]>>> = {
    elasticloadbalancing: ['loadbalancer/', 'targetgroup/'],
    kms: ['alias/'],
};

/** Types whose ARN shape differs from their service's (CloudWatch dashboards are global; alarms are regional). */
const SHAPE_OVERRIDES: Readonly<Record<string, ArnShape>> = { 'cloudwatch:dashboard/': 'accountOnly' };

const prefixOf = (service: TierService, type: string): string => {
    const shape: ArnShape = SHAPE_OVERRIDES[`${service}:${type}`] ?? SERVICE_SHAPES[service];

    if (shape === 'bucket') {
        return `arn:aws:${service}:::`;
    }

    return shape === 'accountOnly' ? `arn:aws:${service}::*:` : `arn:aws:${service}:*:*:`;
};

/**
 * One resource type a Deny must name: its prefix (`role/`, `log-group:`, or `''` for a bare name) and whether the
 * Allows reach names that are also slash-separated paths (`/kitchensink/prod/...`), which need the path forms too.
 */
export interface TierType {
    readonly type: string;
    readonly path: boolean;
}

/** Service -> the resource types a Deny must name. */
export type TierResourceTypes = Readonly<Partial<Record<TierService, readonly TierType[]>>>;

const isTierService = (service: string): service is TierService => service in SERVICE_SHAPES;

/** The resource-type prefix of an ARN's resource part: up to and including its first `/` or `:`, else none. */
const typeOf = (resource: string): string => {
    const literal = resource.split(/[*?]/u)[0] ?? '';
    const delimiter = literal.search(/[/:]/u);

    return delimiter === -1 ? '' : literal.slice(0, delimiter + 1);
};

/**
 * The `[service, type, path]` triples one Allow names: a type per resource ARN of a service that carries names, and
 * the {@link STATIC_TYPES} of each such service the statement grants on `*`.
 *
 * @param statement - One Allow statement.
 * @returns The triples, duplicates included. Pure.
 */
function typesNamedBy(statement: Statement): readonly (readonly [TierService, string, boolean])[] {
    const fromResources = statement.Resource.flatMap((arn) => {
        const fields = arn.split(':');
        const service = fields[2] ?? '';

        if (fields[0] !== 'arn' || !isTierService(service)) {
            return [];
        }

        const resource = fields.slice(5).join(':');

        return [
            [
                service,
                BARE_NAME_SERVICES.has(service) ? '' : typeOf(resource),
                /kitchensink[/?*]/u.test(resource),
            ] as const,
        ];
    });

    const fromWildcard = statement.Resource.includes('*')
        ? statement.Action.flatMap((action) => {
              const service = action.split(':')[0] ?? '';

              return isTierService(service)
                  ? (STATIC_TYPES[service] ?? []).map((type) => [service, type, false] as const)
                  : [];
          })
        : [];

    return [...fromResources, ...fromWildcard];
}

/**
 * The resource types a policy set's Allows name, per service that carries names.
 *
 * IAM refuses a resource whose TYPE segment is a wildcard (`arn:aws:iam::*:*-prod*`: "IAM resource path must either be
 * `*`, root, or start with user/, role/, ..."), so a Deny needs one ARN per type, and the types a Deny needs are
 * exactly the types the Allows reach: derived here, not listed by hand. An Allow with a wildcard where the type
 * belongs names none; `arnGrammar.test.ts` refuses such an Allow.
 *
 * @param statements - The policy set's statements.
 * @param skipResourceTagged - Leave out Allows whose condition is a resource-tag test: a stack-name tag already keeps
 *   the other tier out of those, and the permissions boundary has no room for a second line of defence.
 * @returns Types per service, with {@link STATIC_TYPES} for services allowed on `*`. Pure.
 */
export function resourceTypesOf(statements: readonly Statement[], skipResourceTagged: boolean): TierResourceTypes {
    const types = new Map<TierService, Map<string, boolean>>();

    const add = (service: TierService, type: string, path: boolean): void => {
        const forService = types.get(service) ?? new Map<string, boolean>();

        forService.set(type, (forService.get(type) ?? false) || path);
        types.set(service, forService);
    };

    for (const statement of statements) {
        const tagged = JSON.stringify(statement.Condition ?? {}).includes('ResourceTag');

        if (statement.Effect === 'Allow' && !(skipResourceTagged && tagged)) {
            typesNamedBy(statement).forEach(([service, type, path]) => add(service, type, path));
        }
    }

    return Object.fromEntries(
        [...types].map(([service, forService]) => [
            service,
            [...forService]
                .filter(([type]) => type !== '' || BARE_NAME_SERVICES.has(service))
                .map(([type, path]) => ({ type, path }))
                .sort((left, right) => left.type.localeCompare(right.type)),
        ]),
    );
}

/**
 * The Deny resources that keep one side's names out of reach.
 *
 * @param protectedSide - `production` denies the production names (for the nonprod policies); `nonproduction`
 *   denies the sandbox and preview names (for the prod policies).
 * @param types - The resource types to cover, per service; see {@link resourceTypesOf}.
 * @param form - How much of a name the patterns anchor on; see {@link TierNameForm}.
 * @returns One ARN per service, resource type and name form; the service and the type are concrete. Pure.
 */
export function tierNameResources(
    protectedSide: TierSide,
    types: TierResourceTypes,
    form: TierNameForm = 'anchored',
): string[] {
    return Object.entries(types)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([service, serviceTypes]) =>
            (serviceTypes ?? []).flatMap(({ type, path }) =>
                [...FLAT_FORMS[form][protectedSide], ...(path ? PATH_FORMS[form][protectedSide] : [])].map(
                    (pattern) => `${prefixOf(service as TierService, type)}${type}${pattern}`,
                ),
            ),
        );
}
