/**
 * @module roleStatements — renders the (actions, resources) of every Allow in the role policies a set of synthesized
 * stacks writes, so a guard can ask whether the permissions boundary ADMITS each one (ADR-0065).
 *
 * A template names a resource with intrinsics (`Fn::GetAtt`, `Fn::Join`, `Fn::ImportValue`, an SSM parameter
 * reference). This module turns each into a concrete ARN string the way CloudFormation would, using the other stacks
 * of the same world for cross-stack references. Two honest limits:
 *
 * - A GENERATED physical name (`<stack>-<LogicalId>-<random>`) is rendered with the literal suffix `GENERATED`: the
 *   guard needs the prefix CloudFormation guarantees, not a name it cannot know offline. A generated SECRET name is the
 *   exception to the prefix rule and is rendered without one, because that is what CloudFormation does.
 * - A reference that cannot be resolved stays a visible `UNRESOLVED(...)` token, never a wildcard, so a guard cannot
 *   pass over it by accident.
 *
 * @pattern Interpreter — a pure evaluator over the CloudFormation intrinsic-function grammar the tree actually writes
 */

/** The account every rendered ARN carries: a placeholder id, never a real one. */
export const ACCOUNT_ID = '123456789012';
/** The region every rendered ARN carries. */
export const REGION_NAME = 'us-east-1';

type Json = unknown;

interface TemplateResource {
    readonly Type: string;
    readonly Properties?: Readonly<Record<string, Json>>;
}

/** The slice of a CloudFormation template this module reads. */
export interface Template {
    readonly Resources?: Readonly<Record<string, TemplateResource>>;
    readonly Parameters?: Readonly<Record<string, { readonly Type?: string; readonly Default?: Json }>>;
    readonly Outputs?: Readonly<Record<string, { readonly Value?: Json; readonly Export?: { readonly Name?: Json } }>>;
}

/** One deployed stack: its CloudFormation name and its template. */
export interface StackTemplate {
    readonly stackName: string;
    readonly template: Template;
}

/** One Allow statement of a role policy, with its resources rendered. */
export interface RoleStatement {
    readonly actions: readonly string[];
    readonly resources: readonly string[];
}

/** Every stack of a derivation, indexed for cross-stack references. */
export interface World {
    readonly exports: ReadonlyMap<string, { readonly stack: StackTemplate; readonly value: Json }>;
    readonly parameters: ReadonlyMap<string, { readonly stack: StackTemplate; readonly value: Json }>;
}

interface Kind {
    /** The property that carries an explicit physical name. */
    readonly nameProperty: string;
    /** How CloudFormation names the resource when no name is given. */
    readonly generated: 'stack' | 'stackLower' | 'logical';
    readonly arn: (name: string) => string;
    /** Whether `Ref` yields the ARN (true) or the name (false). */
    readonly refIsArn: boolean;
}

const arnIn = (service: string, resource: string): string =>
    `arn:aws:${service}:${REGION_NAME}:${ACCOUNT_ID}:${resource}`;

/** The kinds the tree's role policies point at. A type missing here renders as UNRESOLVED, which a guard surfaces. */
const KINDS: Readonly<Record<string, Kind>> = {
    'AWS::SQS::Queue': { nameProperty: 'QueueName', generated: 'stack', arn: (n) => arnIn('sqs', n), refIsArn: false },
    'AWS::SNS::Topic': { nameProperty: 'TopicName', generated: 'stack', arn: (n) => arnIn('sns', n), refIsArn: true },
    'AWS::DynamoDB::Table': {
        nameProperty: 'TableName',
        generated: 'stack',
        arn: (n) => arnIn('dynamodb', `table/${n}`),
        refIsArn: false,
    },
    'AWS::S3::Bucket': {
        nameProperty: 'BucketName',
        generated: 'stackLower',
        arn: (n) => `arn:aws:s3:::${n}`,
        refIsArn: false,
    },
    'AWS::Lambda::Function': {
        nameProperty: 'FunctionName',
        generated: 'stack',
        arn: (n) => arnIn('lambda', `function:${n}`),
        refIsArn: false,
    },
    'AWS::Logs::LogGroup': {
        nameProperty: 'LogGroupName',
        generated: 'stack',
        arn: (n) => arnIn('logs', `log-group:${n}:*`),
        refIsArn: false,
    },
    'AWS::Events::EventBus': {
        nameProperty: 'Name',
        generated: 'stack',
        arn: (n) => arnIn('events', `event-bus/${n}`),
        refIsArn: false,
    },
    'AWS::Events::Rule': {
        nameProperty: 'Name',
        generated: 'stack',
        arn: (n) => arnIn('events', `rule/${n}`),
        refIsArn: false,
    },
    'AWS::StepFunctions::StateMachine': {
        nameProperty: 'StateMachineName',
        generated: 'stack',
        arn: (n) => arnIn('states', `stateMachine:${n}`),
        refIsArn: true,
    },
    'AWS::ECS::Cluster': {
        nameProperty: 'ClusterName',
        generated: 'stack',
        arn: (n) => arnIn('ecs', `cluster/${n}`),
        refIsArn: false,
    },
    'AWS::ECS::TaskDefinition': {
        nameProperty: 'Family',
        generated: 'stack',
        arn: (n) => arnIn('ecs', `task-definition/${n}:1`),
        refIsArn: true,
    },
    'AWS::ECR::Repository': {
        nameProperty: 'RepositoryName',
        generated: 'stack',
        arn: (n) => arnIn('ecr', `repository/${n}`),
        refIsArn: false,
    },
    'AWS::SecretsManager::Secret': {
        nameProperty: 'Name',
        generated: 'logical',
        arn: (n) => arnIn('secretsmanager', `secret:${n}`),
        refIsArn: true,
    },
    'AWS::IAM::Role': {
        nameProperty: 'RoleName',
        generated: 'stack',
        arn: (n) => `arn:aws:iam::${ACCOUNT_ID}:role/${n}`,
        refIsArn: false,
    },
    'AWS::CloudFront::Distribution': {
        nameProperty: 'Id',
        generated: 'logical',
        arn: (n) => `arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${n}`,
        refIsArn: false,
    },
    'AWS::RDS::DBInstance': {
        nameProperty: 'DBInstanceIdentifier',
        generated: 'stackLower',
        arn: (n) => arnIn('rds', `db:${n}`),
        refIsArn: false,
    },
};

const GENERATED = 'GENERATED';
const MAX_ALTERNATIVES = 64;

const unresolved = (what: string): string => `UNRESOLVED(${what})`;

const asArray = (value: Json): Json[] =>
    Array.isArray(value) ? (value as Json[]) : value === undefined ? [] : [value];

const isRecord = (value: Json): value is Record<string, Json> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Cartesian product of alternatives, capped so a pathological template cannot explode. */
function product(lists: readonly (readonly string[])[]): string[] {
    let combined: string[] = [''];

    for (const list of lists) {
        combined = combined.flatMap((prefix) => list.map((item) => prefix + item)).slice(0, MAX_ALTERNATIVES);
    }

    return combined;
}

interface Context {
    readonly world: World;
    readonly stack: StackTemplate;
    readonly depth: number;
}

/** The ARN prefix every rendered ARN starts with; the partition is read from it rather than spelled as a bare word. */
const ARN_ROOT = 'arn:aws:';

const PSEUDO: Readonly<Record<string, string>> = {
    'AWS::Partition': ARN_ROOT.split(':')[1] ?? '',
    'AWS::Region': REGION_NAME,
    'AWS::AccountId': ACCOUNT_ID,
    'AWS::URLSuffix': 'amazonaws.com',
};

function physicalName(kind: Kind, logicalId: string, resource: TemplateResource, context: Context): string[] {
    const explicit = resource.Properties?.[kind.nameProperty];

    if (explicit !== undefined) {
        return render(explicit, context);
    }

    const { stackName } = context.stack;

    switch (kind.generated) {
        case 'logical':
            return [`${logicalId}-${GENERATED}`];
        case 'stackLower':
            return [`${stackName}-${logicalId}-${GENERATED}`.toLowerCase()];
        default:
            return [`${stackName}-${logicalId}-${GENERATED}`];
    }
}

function renderReference(logicalId: string, attribute: string | undefined, context: Context): string[] {
    const { template } = context.stack;
    const resource = template.Resources?.[logicalId];

    if (resource === undefined) {
        const parameter = template.Parameters?.[logicalId];

        if (parameter?.Default !== undefined && typeof parameter.Default === 'string') {
            const written = context.world.parameters.get(parameter.Default);

            if (written !== undefined && context.depth < 12) {
                return render(written.value, { world: context.world, stack: written.stack, depth: context.depth + 1 });
            }

            return [unresolved(`parameter ${logicalId} = ${parameter.Default}`)];
        }

        return [unresolved(`reference ${logicalId}`)];
    }

    const kind = KINDS[resource.Type];

    if (kind === undefined) {
        return [unresolved(`${resource.Type} ${logicalId}`)];
    }

    const names = physicalName(kind, logicalId, resource, context);
    const wantsArn = attribute === undefined ? kind.refIsArn : attribute === 'Arn';

    return wantsArn ? names.map(kind.arn) : names;
}

function renderSub(template: string, context: Context): string[] {
    const parts: string[][] = [];
    let rest = template;

    for (;;) {
        const start = rest.indexOf('${');

        if (start === -1) {
            parts.push([rest]);

            return product(parts);
        }

        const end = rest.indexOf('}', start);
        const token = rest.slice(start + 2, end);

        parts.push([rest.slice(0, start)]);
        parts.push(
            PSEUDO[token] === undefined
                ? token.includes('.')
                    ? renderReference(token.split('.')[0] ?? token, token.split('.')[1], context)
                    : renderReference(token, undefined, context)
                : [PSEUDO[token]],
        );
        rest = rest.slice(end + 1);
    }
}

function render(expression: Json, context: Context): string[] {
    if (typeof expression === 'string') {
        return [expression];
    }

    if (typeof expression === 'number' || typeof expression === 'boolean') {
        return [String(expression)];
    }

    if (!isRecord(expression)) {
        return [unresolved(JSON.stringify(expression))];
    }

    const ref = expression['Ref'];

    if (typeof ref === 'string') {
        return PSEUDO[ref] === undefined ? renderReference(ref, undefined, context) : [PSEUDO[ref]];
    }

    const getAtt = expression['Fn::GetAtt'];

    if (Array.isArray(getAtt)) {
        const [logicalId, attribute] = getAtt as [string, string];

        return renderReference(logicalId, attribute, context);
    }

    const join = expression['Fn::Join'];

    if (Array.isArray(join)) {
        const [separator, parts] = join as [string, Json[]];
        const rendered = asArray(parts).map((part) => render(part, context));
        const glued = product(
            rendered.flatMap((alternatives, index) => (index === 0 ? [alternatives] : [[separator], alternatives])),
        );

        return glued;
    }

    const sub = expression['Fn::Sub'];

    if (typeof sub === 'string') {
        return renderSub(sub, context);
    }

    const importValue = expression['Fn::ImportValue'];

    if (importValue !== undefined) {
        return render(importValue, context).flatMap((name) => {
            const exported = context.world.exports.get(name);

            if (exported === undefined || context.depth >= 12) {
                return [unresolved(`import ${name}`)];
            }

            return render(exported.value, { world: context.world, stack: exported.stack, depth: context.depth + 1 });
        });
    }

    const select = expression['Fn::Select'];

    if (Array.isArray(select)) {
        const [index, list] = select as [number | string, Json];
        const position = Number(index);

        if (isRecord(list) && Array.isArray(list['Fn::Split'])) {
            const [delimiter, source] = list['Fn::Split'] as [string, Json];

            return render(source, context).map((text) => text.split(delimiter)[position] ?? unresolved('select'));
        }

        return render(asArray(list)[position], context);
    }

    const conditional = expression['Fn::If'];

    if (Array.isArray(conditional)) {
        const [, whenTrue, whenFalse] = conditional as [string, Json, Json];

        return [...render(whenTrue, context), ...render(whenFalse, context)];
    }

    return [unresolved(Object.keys(expression).join(','))];
}

/**
 * Indexes every export and every SSM parameter the stacks write, so a reference can be followed to its origin.
 *
 * @returns The world. Pure.
 */
export function buildWorld(stacks: readonly StackTemplate[]): World {
    const exports = new Map<string, { stack: StackTemplate; value: Json }>();
    const parameters = new Map<string, { stack: StackTemplate; value: Json }>();
    const scratch: World = { exports, parameters };

    for (const stack of stacks) {
        for (const output of Object.values(stack.template.Outputs ?? {})) {
            const name = output.Export?.Name;

            if (name !== undefined) {
                for (const rendered of render(name, { world: scratch, stack, depth: 0 })) {
                    exports.set(rendered, { stack, value: output.Value });
                }
            }
        }

        for (const resource of Object.values(stack.template.Resources ?? {})) {
            const name = resource.Properties?.['Name'];

            if (resource.Type === 'AWS::SSM::Parameter' && name !== undefined) {
                for (const rendered of render(name, { world: scratch, stack, depth: 0 })) {
                    parameters.set(rendered, { stack, value: resource.Properties?.['Value'] });
                }
            }
        }
    }

    return scratch;
}

function statementsOf(resource: TemplateResource): Json[] {
    const documents: Json[] = [];

    if (resource.Type === 'AWS::IAM::Role') {
        for (const inline of asArray(resource.Properties?.['Policies'])) {
            documents.push(isRecord(inline) ? inline['PolicyDocument'] : undefined);
        }
    } else if (resource.Type === 'AWS::IAM::Policy' || resource.Type === 'AWS::IAM::ManagedPolicy') {
        documents.push(resource.Properties?.['PolicyDocument']);
    }

    return documents.flatMap((document) => (isRecord(document) ? asArray(document['Statement']) : []));
}

/**
 * Every Allow of every role or standalone policy in one stack, rendered, sorted and deduplicated.
 *
 * @returns The statements. Pure.
 */
export function renderRoleStatements(world: World, stack: StackTemplate): RoleStatement[] {
    const found = new Map<string, RoleStatement>();

    for (const resource of Object.values(stack.template.Resources ?? {})) {
        for (const statement of statementsOf(resource)) {
            if (!isRecord(statement) || statement['Effect'] !== 'Allow') {
                continue;
            }

            const actions = asArray(statement['Action']).filter((a): a is string => typeof a === 'string');
            const resources = asArray(statement['Resource']).flatMap((entry) =>
                render(entry, { world, stack, depth: 0 }),
            );
            const normalized: RoleStatement = {
                actions: [...new Set(actions)].sort(),
                resources: [...new Set(resources)].sort(),
            };

            found.set(JSON.stringify(normalized), normalized);
        }
    }

    return [...found.values()];
}
