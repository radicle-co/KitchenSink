/**
 * The AWS CLI scanner, fired at a table of SHAPES, because the guard built on it (`awsCliObserveCoverage.test.ts`)
 * exists to catch the call nobody listed: it is only as good as the shapes this scanner recognises, so each shape a
 * CI file has used is a row, and each row names what a miss would cost.
 */
import { describe, expect, it } from 'vitest';

import { iamActionsFor, scanAwsInvocations, type AwsInvocation } from './awsCliScan.js';

type Shape = readonly [name: string, language: 'shell' | 'script', text: string, expected: readonly string[]];

/** `service verb` (or `service verb waiter`) per invocation found, in order. `?` is an unresolvable service or verb. */
const found = (invocations: readonly AwsInvocation[]): string[] =>
    invocations.map((i) => [i.service, i.verb, ...(i.argument === undefined ? [] : [i.argument])].join(' '));

const shapes: readonly Shape[] = [
    ['plain command', 'shell', 'aws ecs describe-services --cluster c', ['ecs describe-services']],
    ['YAML run line', 'shell', '        run: aws sqs get-queue-url --queue-name q', ['sqs get-queue-url']],
    [
        'region flag before the service',
        'shell',
        'aws --region us-east-1 logs describe-log-groups',
        ['logs describe-log-groups'],
    ],
    [
        'equals-form flags before the service',
        'shell',
        'aws --region=us-east-1 --output=json rds describe-db-instances',
        ['rds describe-db-instances'],
    ],
    ['boolean flag before the service', 'shell', 'aws --no-cli-pager ecs list-tasks', ['ecs list-tasks']],
    [
        'quoted flag value with spaces',
        'shell',
        `aws --profile "my profile" sns get-topic-attributes`,
        ['sns get-topic-attributes'],
    ],
    [
        'command substitution',
        'shell',
        'ARN="$(aws stepfunctions list-executions --state-machine-arn x)"',
        ['stepfunctions list-executions'],
    ],
    ['backtick substitution', 'shell', 'x=`aws ec2 describe-instances`', ['ec2 describe-instances']],
    [
        'after a pipe, && and ;',
        'shell',
        'a | aws iam get-role-policy; b && aws iam get-policy',
        ['iam get-role-policy', 'iam get-policy'],
    ],
    [
        'line continuation joins the command',
        'shell',
        'aws \\\n  --region us-east-1 \\\n  ecs list-clusters',
        ['ecs list-clusters'],
    ],
    [
        'a wait subcommand keeps its waiter',
        'shell',
        'aws ecs wait tasks-stopped --cluster c --tasks t',
        ['ecs wait tasks-stopped'],
    ],
    [
        'two on one line',
        'shell',
        'aws ecs list-tasks && aws ecs list-services',
        ['ecs list-tasks', 'ecs list-services'],
    ],
    [
        'a full-line comment is skipped',
        'shell',
        '# aws sns publish --topic-arn x\naws sns list-topics',
        ['sns list-topics'],
    ],
    ['a trailing comment is skipped', 'shell', 'aws ecs list-tasks # not aws sns publish', ['ecs list-tasks']],
    [
        'a hash inside quotes is not a comment',
        'shell',
        `aws ssm get-parameter --name "/a#b" && aws ecs list-tasks`,
        ['ssm get-parameter', 'ecs list-tasks'],
    ],
    ['a variable service cannot be resolved', 'shell', 'aws "$SERVICE" describe-things', ['? describe-things']],
    ['a variable verb cannot be resolved', 'shell', 'aws ecs "$VERB" --cluster c', ['ecs ?']],
    ['an echoed operator hint is prose', 'shell', `echo "::error::  aws logs create-log-group --log-group-name x"`, []],
    [
        'a workflow annotation is prose',
        'shell',
        `        run: echo "::warning::run aws ecs update-service by hand"`,
        [],
    ],
    ['printf prose is skipped', 'shell', `printf 'try: aws sns publish --topic-arn t\\n'`, []],
    [
        'a command substitution inside an echo still runs',
        'shell',
        `echo "arn: $(aws sns list-topics)"`,
        ['sns list-topics'],
    ],
    ['a command after echo and a separator runs', 'shell', `echo start; aws sns list-topics`, ['sns list-topics']],
    ['--version is not an invocation', 'shell', 'aws --version', []],
    ['an action reference is not an invocation', 'shell', 'uses: aws-actions/configure-aws-credentials@v4', []],
    ['a path that contains aws is not an invocation', 'shell', 'cat ~/.aws/credentials; ls /usr/local/aws ecs', []],
    ['an env var is not an invocation', 'shell', 'AWS_REGION=us-east-1 aws_helper ecs list-tasks', []],

    [
        'execFile literal argv',
        'script',
        `await execFile('aws', ['cloudwatch', 'get-metric-statistics', '--region', r]);`,
        ['cloudwatch get-metric-statistics'],
    ],
    [
        'execFileAsync literal argv',
        'script',
        `execFileAsync("aws", ["logs", "describe-log-groups"], { timeout: 1 })`,
        ['logs describe-log-groups'],
    ],
    [
        'spawnSync literal argv across lines',
        'script',
        `const r = spawnSync(\n  'aws',\n  [\n    'lambda',\n    'invoke',\n    '--region',\n    o.region,\n  ],\n  {},\n);`,
        ['lambda invoke'],
    ],
    [
        'flags before the service in argv',
        'script',
        `execFileSync('aws', ['--region', region, 'ecs', 'list-tasks'])`,
        ['ecs list-tasks'],
    ],
    [
        'argv held in a variable (the collectMetrics shape)',
        'script',
        `const args = [\n 'cloudwatch',\n 'get-metric-statistics',\n '--region',\n R,\n];\nargs.push('--x');\nawait execFileAsync('aws', args, {});`,
        ['cloudwatch get-metric-statistics'],
    ],
    ['argv held in a variable that is never declared', 'script', `execFileAsync('aws', someArgs, {})`, ['? ?']],
    ['a spread-led argv cannot be resolved', 'script', `spawnSync('aws', [...args], {})`, ['? ?']],
    [
        'a wrapper function taking the binary first',
        'script',
        `run('aws', ['sns', 'get-topic-attributes'])`,
        ['sns get-topic-attributes'],
    ],
    ['a line comment around execFile is skipped', 'script', `// execFile('aws', ['sns', 'publish'])\nconst x = 1;`, []],
    ['a block comment around a command is skipped', 'script', `/* aws sns publish --topic-arn x */\nconst x = 1;`, []],
    [
        'prose in a JSDoc is skipped',
        'script',
        `/**\n * Runs \`aws ecs update-service\` by hand.\n */\nexport const x = 1;`,
        [],
    ],
    [
        'a command inside a template string is a command',
        'script',
        'const cmd = `aws ecs describe-services --cluster ${c}`;',
        ['ecs describe-services'],
    ],
    [
        'a wrapper function with a spread-led argv resolves through its callers',
        'script',
        `function aws(args) {\n  return execFileSync('aws', [...args, '--output', 'json']);\n}\naws(['lambda', 'get-function-configuration', '--function-name', f]);\naws(['cloudformation', 'list-stack-resources']);`,
        ['lambda get-function-configuration', 'cloudformation list-stack-resources'],
    ],
    [
        'a typed wrapper parameter resolves through its callers',
        'script',
        `function run(args: readonly string[]): string {\n  return spawnSync('aws', [...args, '--output', 'text']).stdout;\n}\nrun(['ssm', 'get-parameter']);`,
        ['ssm get-parameter'],
    ],
    [
        'a wrapper nobody calls with a literal stays unresolved',
        'script',
        `function aws(args) {\n  return execFileSync('aws', [...args]);\n}\naws(buildArgs());`,
        ['? ?'],
    ],
    [
        'prose in an error template is not an unresolved command',
        'script',
        'throw new Error(`aws ${args.slice(0, 2).join(" ")} failed`);',
        [],
    ],
    [
        'a dynamic service in an exec template is unresolved',
        'script',
        'execSync(`aws ${svc} describe-things`);',
        ['? describe-things'],
    ],
    ['a non-aws binary is ignored', 'script', `execFile('git', ['ecs', 'list-tasks'])`, []],
];

describe('scanAwsInvocations', () => {
    it.each(shapes)('%s', (_name, language, text, expected) => {
        expect(found(scanAwsInvocations(text, language))).toEqual(expected);
    });

    it('reports the 1-based line the command starts on, through a continuation', () => {
        const [first] = scanAwsInvocations('echo hi\n\naws \\\n  ecs list-tasks', 'shell');

        expect(first?.line).toBe(3);
    });

    it('keeps line numbers after an earlier continuation', () => {
        const found = scanAwsInvocations('echo a \\\n  b\n\naws ecs list-tasks', 'shell');

        expect(found.map((i) => i.line)).toEqual([4]);
    });

    it('reports the line of an argv call in a script', () => {
        const [first] = scanAwsInvocations(`const a = 1;\nawait execFile('aws', ['ecs', 'list-tasks']);`, 'script');

        expect(first?.line).toBe(2);
    });
});

type Mapping = readonly [service: string, verb: string, argument: string | undefined, expected: readonly string[]];

const mappings: readonly Mapping[] = [
    ['ecs', 'describe-services', undefined, ['ecs:DescribeServices']],
    ['rds', 'describe-db-instances', undefined, ['rds:DescribeDBInstances']],
    ['rds', 'describe-db-clusters', undefined, ['rds:DescribeDBClusters']],
    ['sqs', 'get-queue-url', undefined, ['sqs:GetQueueUrl']],
    ['stepfunctions', 'list-executions', undefined, ['states:ListExecutions']],
    ['resourcegroupstaggingapi', 'get-resources', undefined, ['tag:GetResources']],
    ['cloudwatch', 'get-metric-statistics', undefined, ['cloudwatch:GetMetricStatistics']],
    ['iam', 'get-role-policy', undefined, ['iam:GetRolePolicy']],
    ['lambda', 'invoke', undefined, ['lambda:InvokeFunction']],
    ['ecs', 'wait', 'services-stable', ['ecs:DescribeServices']],
    ['ecs', 'wait', 'tasks-stopped', ['ecs:DescribeTasks']],
    ['rds', 'wait', 'db-instance-available', ['rds:DescribeDBInstances']],
    ['ec2', 'wait', 'instance-running', ['ec2:DescribeInstances']],
    ['logs', 'tail', undefined, ['logs:FilterLogEvents', 'logs:StartLiveTail']],
];

describe('iamActionsFor', () => {
    it.each(mappings)('%s %s %s', (service, verb, argument, expected) => {
        const result = iamActionsFor({ service, verb, argument, line: 1 });

        expect(result).toEqual({ kind: 'actions', actions: expected });
    });

    it('reports a waiter it has no mapping for instead of guessing', () => {
        const result = iamActionsFor({ service: 'ecs', verb: 'wait', argument: 'something-new', line: 1 });

        expect(result.kind).toBe('unmapped');
    });

    it('reports an unresolved service or verb as unmapped', () => {
        expect(iamActionsFor({ service: '?', verb: '?', argument: undefined, line: 1 }).kind).toBe('unmapped');
        expect(iamActionsFor({ service: 'ecs', verb: '?', argument: undefined, line: 1 }).kind).toBe('unmapped');
    });

    it('treats local-only commands as needing no IAM action', () => {
        expect(iamActionsFor({ service: 'configure', verb: 'set', argument: undefined, line: 1 }).kind).toBe('local');
    });

    it('marks the high-level s3 commands out of scope, with a reason', () => {
        const result = iamActionsFor({ service: 's3', verb: 'cp', argument: undefined, line: 1 });

        expect(result.kind).toBe('outOfScope');
    });
});
