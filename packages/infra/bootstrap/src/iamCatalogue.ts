/**
 * @module iamCatalogue — offline judgement of the actions and resource ARNs a policy document names, against a
 * committed snapshot of AWS's Service Authorization Reference.
 *
 * IAM refuses a document for reasons no table-against-table guard can see: an action that does not exist, a wildcard
 * where the ARN's service must be concrete, a region on a resource type that is global. This module is the pure
 * half of the guards for those (`actionCatalogue.test.ts`, `arnGrammar.test.ts`); the snapshot is written by
 * `scripts/refreshIamCatalogue.ts` and `scripts/validatePolicies.ts` is the online authority.
 *
 * @pattern Specification / policy module — a document is judged by data (the reference), not by code that restates it
 */
import { iamLike, patternsOverlap } from './iamPattern.js';
import type { PolicyDocument } from './policyDocument.js';

/** What the reference says about one service. */
export interface IamServiceEntry {
    /** Every action name of the service (`CreateDelivery`), sorted. */
    readonly actions: readonly string[];
    /** The actions whose access level is Read or List (they change nothing), sorted. */
    readonly readOnly: readonly string[];
    /** Resource type -> ARN formats (`arn:${Partition}:logs:${Region}:${Account}:delivery:${DeliveryName}`). */
    readonly resources: Readonly<Record<string, readonly string[]>>;
}

/** The committed snapshot: IAM action prefix -> entry. */
export interface IamCatalogue {
    readonly services: Readonly<Record<string, IamServiceEntry>>;
}

/** Where a policy statement is being judged: its effect and the account it is rendered for. */
export interface ArnContext {
    readonly effect: 'Allow' | 'Deny';
    readonly account: string;
}

const SERVICE_NAME = /^[a-z0-9-]+$/u;

const hasWildcard = (text: string): boolean => text.includes('*') || text.includes('?');

/**
 * The action prefixes and ARN services a set of documents mentions that have a concrete name.
 *
 * @returns Sorted, de-duplicated names: what the snapshot must hold. Pure.
 */
export function catalogueServicesOf(documents: readonly PolicyDocument[]): string[] {
    const services = new Set<string>();

    for (const statement of documents.flatMap((document) => [...document.Statement])) {
        for (const action of statement.Action) {
            const prefix = action.split(':')[0] ?? '';

            if (action.includes(':') && SERVICE_NAME.test(prefix)) {
                services.add(prefix);
            }
        }

        for (const resource of statement.Resource) {
            const service = resource.split(':')[2] ?? '';

            if (resource.startsWith('arn:') && SERVICE_NAME.test(service)) {
                services.add(service);
            }
        }
    }

    return [...services].sort();
}

/**
 * Why an action is not valid, or `undefined` when it is.
 *
 * The service must be a concrete, known prefix; the name part may be a wildcard pattern but must match at least one
 * real action (a pattern that matches none grants nothing and is a typo). `*` alone is valid. Case-insensitive, as
 * IAM's action matching is. Pure.
 */
export function actionProblems(catalogue: IamCatalogue, action: string): string | undefined {
    if (action === '*') {
        return undefined;
    }

    const separator = action.indexOf(':');

    if (separator <= 0 || separator === action.length - 1) {
        return `"${action}" is not <service>:<action>`;
    }

    const service = action.slice(0, separator);
    const name = action.slice(separator + 1);

    if (hasWildcard(service)) {
        return `"${action}" has a wildcard service`;
    }

    const entry = catalogue.services[service.toLowerCase()];

    if (entry === undefined) {
        return `"${action}": no service "${service}" in the snapshot`;
    }

    const lowered = name.toLowerCase();

    return entry.actions.some((candidate) => iamLike(lowered, candidate.toLowerCase()))
        ? undefined
        : `"${action}" matches no ${service} action`;
}

interface ArnFormat {
    /** The ARN's resource part with every `${Placeholder}` as `*`. */
    readonly resource: string;
    /** The literal text that opens the resource part (`role/`, `log-group:`); empty when the type is a bare name. */
    readonly typePrefix: string;
    readonly regional: boolean;
    readonly account: 'none' | 'account';
}

const FORMAT = /^arn:\$\{Partition\}:([^:]+):([^:]*):([^:]*):(.*)$/su;

/** Every ARN format in the snapshot, by ARN service (which is not always the action prefix: key-value stores are cloudfront). */
function formatsByService(catalogue: IamCatalogue): ReadonlyMap<string, readonly ArnFormat[]> {
    const formats = new Map<string, ArnFormat[]>();

    for (const entry of Object.values(catalogue.services)) {
        for (const arnFormats of Object.values(entry.resources)) {
            for (const format of arnFormats) {
                const match = FORMAT.exec(format);

                if (match === null) {
                    continue;
                }

                const [, service, region, account, resource] = match as unknown as [
                    string,
                    string,
                    string,
                    string,
                    string,
                    string,
                ];
                const list = formats.get(service) ?? [];

                list.push({
                    resource: resource.replaceAll(/\$\{[^}]+\}/gu, '*'),
                    typePrefix: resource.split('${')[0] ?? '',
                    regional: region !== '',
                    account: account === '' ? 'none' : 'account',
                });
                formats.set(service, list);
            }
        }
    }

    return formats;
}

/**
 * Why a Resource entry is not a valid ARN for IAM, as a list (empty when it is valid).
 *
 * The region and account fields are judged against the resource TYPES of the ARN's service that the resource part
 * can be (`dashboard/*` is a CloudWatch dashboard, which has no region; `alarm:*` is an alarm, which does). A
 * resource part that is itself all wildcard can be any type, so any type's shape admits it. Pure.
 */
export function arnProblems(catalogue: IamCatalogue, arn: string, context: ArnContext): string[] {
    if (arn === '*') {
        return [];
    }

    const fields = arn.split(':');

    if (fields.length < 6 || fields[0] !== 'arn') {
        return [`"${arn}" is not arn:<partition>:<service>:<region>:<account>:<resource>`];
    }

    const [, partition, service, region, account] = fields as [string, string, string, string, string];
    const resource = fields.slice(5).join(':');

    if (partition !== 'aws') {
        return [`"${arn}": the partition must be "aws"`];
    }

    if (!SERVICE_NAME.test(service)) {
        return [`"${arn}": the service must be fully qualified, with no wildcard`];
    }

    const known = formatsByService(catalogue).get(service);

    if (known === undefined) {
        return [`"${arn}": no service "${service}" in the snapshot`];
    }

    // The resource TYPE (`role/`, `log-group:`) is matched literally: a wildcard may not stand in for it, because IAM
    // rejects a path it cannot place (`arn:aws:iam::*:*-prod*`).
    const literal = resource.split(/[*?]/u)[0] ?? '';
    const candidates = known.filter(
        (format) => patternsOverlap(resource, format.resource) && literal.startsWith(format.typePrefix),
    );

    if (candidates.length === 0) {
        return [`"${arn}": ${service} has no resource type that "${resource}" can be`];
    }

    const accountOk = (format: ArnFormat): boolean => {
        if (format.account === 'none') {
            return account === '';
        }

        return (
            account === context.account ||
            (context.effect === 'Deny' && account === '*') ||
            (service === 'iam' && account === 'aws' && resource.startsWith('policy/'))
        );
    };

    const regionOk = (format: ArnFormat): boolean => (format.regional ? region !== '' : region === '');

    if (candidates.some((format) => regionOk(format) && accountOk(format))) {
        return [];
    }

    const wantsRegion = candidates.some((format) => format.regional);
    const noRegion = candidates.some((format) => !format.regional);

    if (!candidates.some(regionOk)) {
        return [
            `"${arn}": ${service} ${resource.split(/[:/]/u)[0] ?? ''} resources ${
                wantsRegion && !noRegion ? 'need a region' : 'take no region'
            }`,
        ];
    }

    return [
        `"${arn}": the account field must be ${context.account}${context.effect === 'Deny' ? ' or *' : ''}, or empty where the type has none`,
    ];
}

/**
 * The real read-only actions (access level Read or List) an action pattern matches.
 *
 * @returns Action names (`lambda:GetFunction`); empty when the pattern matches none or names an unknown service. Pure.
 */
export function readOnlyActionsMatching(catalogue: IamCatalogue, pattern: string): string[] {
    const separator = pattern.indexOf(':');
    const service = pattern.slice(0, separator).toLowerCase();
    const name = pattern.slice(separator + 1).toLowerCase();

    return (catalogue.services[service]?.readOnly ?? [])
        .filter((action) => iamLike(name, action.toLowerCase()))
        .map((action) => `${service}:${action}`);
}
