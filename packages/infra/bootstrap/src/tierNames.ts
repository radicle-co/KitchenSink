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

/** Which side of the tier line a Deny protects. */
export type TierSide = 'production' | 'nonproduction';

/** How many of the ARN's region and account fields a service fills. */
type ArnShape = 'regional' | 'accountOnly' | 'bucket';

/** The services whose ARNs can carry a resource name, and the shape of their ARNs. */
const SERVICE_SHAPES = {
    cloudformation: 'regional',
    cloudfront: 'accountOnly',
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

/** Services whose names are also slash-separated paths (`/kitchensink/prod/...`, `kitchensink/sandbox/...`). */
const PATH_SERVICES: ReadonlySet<TierService> = new Set<TierService>(['logs', 'secretsmanager', 'ssm']);

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

const prefixOf = (service: TierService): string => {
    const shape: ArnShape = SERVICE_SHAPES[service];

    if (shape === 'bucket') {
        return `arn:aws:${service}:::`;
    }

    return shape === 'accountOnly' ? `arn:aws:${service}::*:` : `arn:aws:${service}:*:*:`;
};

/** The services a Deny of this kind may name, for guards that compare them with what a policy set allows. */
export const TIER_SERVICES: readonly TierService[] = Object.keys(SERVICE_SHAPES).sort() as TierService[];

/**
 * The Deny resources that keep one side's names out of reach, for the given services.
 *
 * @param protectedSide - `production` denies the production names (for the nonprod policies); `nonproduction`
 *   denies the sandbox and preview names (for the prod policies).
 * @param services - The services the policy set allows, as far as their ARNs carry a name.
 * @param form - How much of a name the patterns anchor on; see {@link TierNameForm}.
 * @returns One ARN per service and name form, every service concrete. Pure.
 */
export function tierNameResources(
    protectedSide: TierSide,
    services: readonly TierService[],
    form: TierNameForm = 'anchored',
): string[] {
    return [...services].sort().flatMap((service) => {
        const forms = [
            ...FLAT_FORMS[form][protectedSide],
            ...(PATH_SERVICES.has(service) ? PATH_FORMS[form][protectedSide] : []),
        ];

        return forms.map((form) => `${prefixOf(service)}${form}`);
    });
}
