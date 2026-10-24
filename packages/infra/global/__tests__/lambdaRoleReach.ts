/**
 * The template-reading half of `lambdaRolesCoverTheirSdkCalls`: a synthesized Lambda, the policy statements on its
 * role, and whether those statements admit an SDK permission `sdkPermissionsReachedFrom` found in its code.
 *
 * It reads the plain CloudFormation JSON, not `Template`, so the same functions serve a stack built in this process
 * and an assembly another CDK app synthesized in a child process (`aws-cdk-lib` is installed once PER app and two
 * instances do not mix).
 *
 * ⚠️ NOTHING HERE ASSUMES A SHAPE IT CANNOT SEE. A function whose role is not in its own template, a role carrying a
 * managed policy this file has not read, and a handler no source file answers to all THROW with the function named,
 * because a guard that skips what it cannot map reports green over exactly the functions it was meant to judge.
 *
 * @pattern Specification — pure predicates over a parsed template and a list of required permissions
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { policyAdmits, type PolicyStatementJson } from './iamGlob.js';
import type { RequiredPermission } from './sdkCommandReach.js';

/** The slice of a CloudFormation resource this file reads. */
interface CfnResource {
    readonly Type: string;
    readonly Properties?: Readonly<Record<string, unknown>>;
}

/** A synthesized template, as `JSON.parse` leaves it. */
export interface CfnTemplate {
    readonly Resources?: Readonly<Record<string, CfnResource>>;
}

/** The account and region a template's pseudo-parameters resolve to. */
export interface TemplateEnvironment {
    readonly account: string;
    readonly region: string;
}

/** One synthesized `AWS::Lambda::Function`, with the statements its role carries. */
export interface SynthesizedLambda {
    readonly logicalId: string;
    /** The CDK `handler:` string, e.g. `handlers/identityWebhook.handler`. */
    readonly handler: string;
    readonly runtime: string;
    /** Every statement on the execution role, each resource resolved to a string (see {@link resolvedText}). */
    readonly statements: readonly PolicyStatementJson[];
}

/**
 * AWS-managed policies a Lambda role may carry without this guard reading them: both grant only log delivery and, for
 * the VPC one, network-interface management, none of which a handler reaches through an SDK command.
 */
const READ_MANAGED_POLICIES: Readonly<Record<string, string>> = {
    AWSLambdaBasicExecutionRole: 'logs:CreateLogGroup/CreateLogStream/PutLogEvents only',
    AWSLambdaVPCAccessExecutionRole: 'the above plus ec2 network-interface create/describe/delete/assign only',
};

/** A value as one-element-or-many, as the template spells it. */
export const listOf = <T>(value: T | readonly T[] | undefined): readonly T[] =>
    value === undefined ? [] : Array.isArray(value) ? value : [value as T];

/**
 * A template value as a string: the pseudo-parameters filled in, a `Fn::Join` flattened, and any other reference left
 * as a named placeholder that matches only a `*`.
 *
 * @param value - A string or an intrinsic.
 * @param env - What `AWS::AccountId` and `AWS::Region` resolve to.
 * @returns The text. Pure.
 */
export function resolvedText(value: unknown, env: TemplateEnvironment): string {
    if (typeof value === 'string') {
        return value;
    }

    const record = value as Record<string, unknown>;
    const ref = record['Ref'];

    if (ref === 'AWS::Partition') {
        return 'aws';
    }

    if (ref === 'AWS::Region') {
        return env.region;
    }

    if (ref === 'AWS::AccountId') {
        return env.account;
    }

    const join = record['Fn::Join'] as [string, unknown[]] | undefined;

    if (join !== undefined) {
        return join[1].map((part) => resolvedText(part, env)).join(join[0]);
    }

    const sub = record['Fn::Sub'];

    if (typeof sub === 'string') {
        return sub
            .replaceAll('${AWS::Partition}', 'aws')
            .replaceAll('${AWS::Region}', env.region)
            .replaceAll('${AWS::AccountId}', env.account);
    }

    return `<${JSON.stringify(value)}>`;
}

/** The logical id a `{ 'Fn::GetAtt': [id, …] }` or `{ Ref: id }` names, if it is one. */
function referencedId(value: unknown): string | undefined {
    const record = value as { 'Fn::GetAtt'?: [string, string]; Ref?: string } | undefined;

    return record?.['Fn::GetAtt']?.[0] ?? record?.Ref;
}

/** The names of the AWS-managed policies a role attaches, from the ARNs it lists. */
function managedPolicyNames(role: CfnResource, env: TemplateEnvironment): readonly string[] {
    return listOf(role.Properties?.['ManagedPolicyArns']).map((arn) => resolvedText(arn, env).split('/').at(-1) ?? '');
}

/**
 * The statements on one role: its inline `Policies`, every `AWS::IAM::Policy` and `AWS::IAM::ManagedPolicy` the stack
 * attaches to it, with each resource resolved to a string.
 *
 * @param template - The role's template.
 * @param roleId - The role's logical id.
 * @param env - Pseudo-parameter values.
 * @returns The statements. Pure.
 * @throws Error when the role carries an AWS-managed policy not in {@link READ_MANAGED_POLICIES}.
 */
export function roleStatementsOf(
    template: CfnTemplate,
    roleId: string,
    env: TemplateEnvironment,
): readonly PolicyStatementJson[] {
    const resources = Object.values(template.Resources ?? {});
    const role = template.Resources?.[roleId];

    if (role?.Type !== 'AWS::IAM::Role') {
        throw new Error(`${roleId} is not an AWS::IAM::Role in this template, so its grants cannot be read`);
    }

    const unread = managedPolicyNames(role, env).filter((name) => !(name in READ_MANAGED_POLICIES));

    if (unread.length > 0) {
        throw new Error(
            `${roleId} carries managed policies this guard has not read: ${unread.join(', ')} — add each to ` +
                'READ_MANAGED_POLICIES with what it grants, or the guard is judging a smaller policy than the role has',
        );
    }

    const documents = [
        ...listOf(role.Properties?.['Policies'] as { PolicyDocument: unknown }[] | undefined).map(
            (policy) => policy.PolicyDocument,
        ),
        ...resources
            .filter(
                (resource) =>
                    (resource.Type === 'AWS::IAM::Policy' || resource.Type === 'AWS::IAM::ManagedPolicy') &&
                    listOf(resource.Properties?.['Roles']).some((attached) => referencedId(attached) === roleId),
            )
            .map((resource) => resource.Properties?.['PolicyDocument']),
    ] as { Statement: PolicyStatementJson | PolicyStatementJson[] }[];

    return documents
        .flatMap((document) => listOf(document.Statement))
        .map((statement) => ({
            ...statement,
            ...(statement.Resource === undefined
                ? {}
                : { Resource: listOf(statement.Resource as unknown).map((resource) => resolvedText(resource, env)) }),
        }));
}

/** A property that must be a literal string; an intrinsic there means this guard cannot know what runs. */
function stringProperty(logicalId: string, resource: CfnResource, name: string): string {
    const value = resource.Properties?.[name];

    if (typeof value !== 'string') {
        throw new Error(
            `${logicalId}.${name} is not a literal string (${JSON.stringify(value)}); this guard cannot read it`,
        );
    }

    return value;
}

/**
 * Every `AWS::Lambda::Function` in a template, with its handler, runtime and role statements.
 *
 * @param template - A synthesized stack template.
 * @param env - Pseudo-parameter values.
 * @returns One entry per function. Pure.
 * @throws Error for a function whose `Role` is not an `AWS::IAM::Role` of this template.
 */
export function lambdaFunctionsOf(template: CfnTemplate, env: TemplateEnvironment): readonly SynthesizedLambda[] {
    return Object.entries(template.Resources ?? {})
        .filter(([, resource]) => resource.Type === 'AWS::Lambda::Function')
        .map(([logicalId, resource]) => {
            const roleId = referencedId(resource.Properties?.['Role']);

            if (roleId === undefined) {
                throw new Error(`${logicalId} has no execution role in its own template — this guard cannot judge it`);
            }

            return {
                logicalId,
                handler: stringProperty(logicalId, resource, 'Handler'),
                runtime: stringProperty(logicalId, resource, 'Runtime'),
                statements: roleStatementsOf(template, roleId, env),
            };
        });
}

/**
 * Whether the statements admit one required permission (conditions ignored).
 *
 * On the resource AWS evaluates when the analysis knows it; otherwise it is enough that the role lets the action
 * reach SOMETHING it names, because the resource a handler passes at run time is not in its source.
 *
 * @param statements - The role's statements.
 * @param permission - One permission the code needs.
 * @param env - Fills `{region}` and `{account}` in `evaluatedOn`.
 * @returns True when admitted. Pure.
 */
export function admits(
    statements: readonly PolicyStatementJson[],
    permission: RequiredPermission,
    env: TemplateEnvironment,
): boolean {
    if (permission.evaluatedOn !== undefined) {
        const resource = permission.evaluatedOn.replace('{region}', env.region).replace('{account}', env.account);

        return policyAdmits(statements, permission.action, resource);
    }

    return statements
        .filter((statement) => statement.Effect === 'Allow')
        .flatMap((statement) => listOf(statement.Resource))
        .some((resource) => policyAdmits(statements, permission.action, resource));
}

/** The permissions the statements do not admit, each rendered `action [on resource] (site)`. Pure. */
export function missingFrom(
    statements: readonly PolicyStatementJson[],
    permissions: readonly RequiredPermission[],
    env: TemplateEnvironment,
): readonly string[] {
    return permissions
        .filter((permission) => !admits(statements, permission, env))
        .map(
            (permission) =>
                `${permission.action}${permission.evaluatedOn === undefined ? '' : ` on ${permission.evaluatedOn}`} (${permission.site})`,
        );
}

/** The module a CDK `handler:` names: everything before its LAST dot (`handlers/a.handler` → `handlers/a`). */
export function handlerModule(handler: string): string {
    const dot = handler.lastIndexOf('.');

    if (dot <= 0) {
        throw new Error(`'${handler}' is not a <module>.<export> handler string`);
    }

    return handler.slice(0, dot);
}

/**
 * The TypeScript source a bundled handler was built from.
 *
 * Every bundle in this repository is built with `outbase: 'src'`, so the handler's module path is its source path
 * under the owning package's `src/`. A handler built any other way is named in `overrides` with the reason.
 *
 * @param packageRoot - The package that owns the handler, absolute.
 * @param handler - The CDK `handler:` string.
 * @param overrides - Repo-relative-to-package source paths for handlers that break the rule.
 * @returns The absolute source path. Impure.
 * @sideEffect Checks the file exists.
 * @throws Error when no source file answers to the handler.
 */
export function handlerSource(
    packageRoot: string,
    handler: string,
    overrides: Readonly<Record<string, string>>,
): string {
    const relative = overrides[handler] ?? path.join('src', `${handlerModule(handler)}.ts`);
    const source = path.join(packageRoot, relative);

    if (!existsSync(source)) {
        throw new Error(
            `handler '${handler}' maps to ${source}, which does not exist — fix the bundle layout or name the ` +
                'handler in HANDLER_SOURCE_OVERRIDES with the reason',
        );
    }

    return source;
}
