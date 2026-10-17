/**
 * Integration suite for `.github/scripts/remoteSearchKeyRetirement.sh` — step 3 of the signing key rotation runbook
 * in `lib/platform/RemoteSearchSharedStack.ts`, as a check instead of a sentence.
 *
 * ## The failure it stops
 *
 * Food reads the key-pair id at deploy and keeps it in its task definition. A preview whose food did not change is
 * not redeployed (`deployGate.sh`), so after step 1 it still signs with the old key. Dropping the old generation
 * (step 3) then removes the key CloudFront trusts for that food, and every search it sends is CloudFront's own `403`.
 * So the global deploy refuses to retire a key-pair id while any food service still RUNS a task definition naming it.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the script, run as `bash` in a child process, over a cloud assembly laid out as `cdk synth` writes it.
 * - **Stubbed**: the AWS CLI, an `aws` first on `PATH` that logs every call and answers from fixtures. CloudFormation
 *   and ECS cannot be stood up here, and this seam is where the script talks to them.
 *
 * The population is the task definitions a service's DEPLOYMENTS name (the primary and any in flight), never a task
 * definition family: CDK never deregisters an old revision, so every old revision names the old key forever.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/remoteSearchKeyRetirement.sh', import.meta.url));
const STACK = 'kitchensink-remote-search-shared-sandbox';

/**
 * A stub `aws` that logs each call and answers from the files the test writes. A call it has a `STUB_*_ERROR` for
 * fails as the CLI does: a message on stderr and exit 255.
 */
const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AWS_CALL_LOG"
arg_after() {
    local flag="$1"; shift
    while [ "$#" -gt 0 ]; do
        if [ "$1" = "$flag" ]; then echo "$2"; return; fi
        shift
    done
}
case "$1 $2" in
    'cloudformation list-stack-resources')
        if [ -n "\${STUB_STACK_ERROR-}" ]; then echo "\${STUB_STACK_ERROR}" >&2; exit 255; fi
        cat "$AWS_STUB_DIR/stackKeys" 2>/dev/null || true
        ;;
    'ecs list-clusters') cat "$AWS_STUB_DIR/clusters" 2>/dev/null || true ;;
    'ecs list-services')
        cluster=$(arg_after --cluster "$@")
        cat "$AWS_STUB_DIR/services.\${cluster##*/}" 2>/dev/null || true
        ;;
    'ecs describe-services')
        cluster=$(arg_after --cluster "$@")
        cat "$AWS_STUB_DIR/deployments.\${cluster##*/}"
        ;;
    'ecs describe-task-definition')
        if [ -n "\${STUB_TASK_DEFINITION_ERROR-}" ]; then echo "\${STUB_TASK_DEFINITION_ERROR}" >&2; exit 255; fi
        definition=$(arg_after --task-definition "$@")
        cat "$AWS_STUB_DIR/taskDefinition.\${definition##*/}"
        ;;
    *) echo "unexpected aws call: $*" >&2; exit 254 ;;
esac
`;

const OLD_KEY = 'K1OLDGENERATION';
const NEW_KEY = 'K2NEWGENERATION';
const FOOD_CLUSTER = 'arn:aws:ecs:us-east-1:040663841500:cluster/kitchensink-food-service-pr-91-FoodServiceCluster-AAA';
const OTHER_APP_CLUSTER = 'arn:aws:ecs:us-east-1:040663841500:cluster/armoury-production-Cluster-ZZZ';
const FOOD_API =
    'arn:aws:ecs:us-east-1:040663841500:service/kitchensink-food-service-pr-91-FoodServiceCluster-AAA/FoodApi';
const definition = (revision: number): string =>
    `arn:aws:ecs:us-east-1:040663841500:task-definition/kitchensinkfoodservicepr91FoodApiTaskDefinition:${String(revision)}`;

let workdir: string;
let binDir: string;
let assembly: string;
let logFile: string;

/** What one run did. */
interface RunResult {
    readonly status: number;
    readonly output: string;
    readonly calls: readonly string[];
}

/**
 * Lay out a cloud assembly holding the shared stack's template with these public keys.
 *
 * @param keptGenerations - The generations the synthesized template keeps.
 */
function synthesized(keptGenerations: readonly number[]): void {
    const resources = Object.fromEntries(
        keptGenerations.map((generation) => [
            `SigningKey${String(generation)}PublicKeyA1B2C3D4`,
            { Type: 'AWS::CloudFront::PublicKey', Properties: {} },
        ]),
    );

    writeFileSync(
        join(assembly, 'manifest.json'),
        JSON.stringify({
            version: '48.0.0',
            artifacts: {
                GlobalsandboxRemoteSearchSharedsandbox5E6F7A8B: {
                    type: 'aws:cloudformation:stack',
                    properties: { templateFile: 'shared.template.json', stackName: STACK },
                },
                Globalsandbox: {
                    type: 'aws:cloudformation:stack',
                    properties: { templateFile: 'global.template.json', stackName: 'kitchensink-global-sandbox' },
                },
            },
        }),
    );
    writeFileSync(join(assembly, 'shared.template.json'), JSON.stringify({ Resources: resources }));
}

/**
 * A task definition whose one container carries this environment.
 *
 * @param environment - Its environment.
 * @returns The `describe-task-definition` answer.
 */
function taskDefinitionWith(environment: Readonly<Record<string, string>>): string {
    return JSON.stringify({
        taskDefinition: {
            containerDefinitions: [
                {
                    name: 'FoodApiContainer',
                    environment: Object.entries(environment).map(([name, value]) => ({ name, value })),
                },
            ],
        },
    });
}

/**
 * The `describe-services` answer for the food API with these deployments.
 *
 * @param definitions - The task definition each deployment names, primary first.
 * @returns The answer.
 */
function deploymentsOf(...definitions: readonly string[]): string {
    return JSON.stringify({
        services: [{ serviceArn: FOOD_API, deployments: definitions.map((taskDefinition) => ({ taskDefinition })) }],
    });
}

/** Both generations deployed: the state between steps 1 and 3. */
const BOTH_DEPLOYED = `SigningKey1PublicKeyA1B2C3D4\t${OLD_KEY}\nSigningKey2PublicKeyA1B2C3D4\t${NEW_KEY}`;

/** The food cluster, with the food API in it. */
const FOOD_CLUSTER_FIXTURES = {
    clusters: `${FOOD_CLUSTER}\t${OTHER_APP_CLUSTER}`,
    'services.kitchensink-food-service-pr-91-FoodServiceCluster-AAA': FOOD_API,
};

/**
 * Run the real script with the stub CLI first on PATH.
 *
 * @param fixtures - The files the stub answers from.
 * @param environment - Extra environment for the stub.
 * @returns What the run did.
 */
function run(
    fixtures: Readonly<Record<string, string>>,
    environment: Readonly<Record<string, string>> = {},
): RunResult {
    for (const [name, value] of Object.entries(fixtures)) {
        writeFileSync(join(workdir, name), `${value}\n`);
    }

    const result = spawnSync('bash', [SCRIPT, 'check', 'us-east-1', STACK, assembly], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
            AWS_CALL_LOG: logFile,
            AWS_STUB_DIR: workdir,
            ...environment,
        },
    });
    const calls = existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
              .split('\n')
              .filter((line) => line.length > 0)
        : [];

    return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}`, calls };
}

beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'key-retirement-'));
    binDir = join(workdir, 'bin');
    assembly = join(workdir, 'cdk.out');
    logFile = join(workdir, 'aws-calls.log');
    mkdirSync(binDir);
    mkdirSync(assembly);
    writeFileSync(join(binDir, 'aws'), AWS_STUB);
    chmodSync(join(binDir, 'aws'), 0o755);
});

afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
});

describe('remoteSearchKeyRetirement.sh — dropping a generation (step 3)', () => {
    it('refuses while the food API’s PRIMARY deployment still signs with the retiring key, and names it', () => {
        synthesized([2]);

        const { status, output } = run({
            ...FOOD_CLUSTER_FIXTURES,
            stackKeys: BOTH_DEPLOYED,
            'deployments.kitchensink-food-service-pr-91-FoodServiceCluster-AAA': deploymentsOf(definition(7)),
            'taskDefinition.kitchensinkfoodservicepr91FoodApiTaskDefinition:7': taskDefinitionWith({
                REMOTE_SEARCH_KEY_PAIR_ID: OLD_KEY,
            }),
        });

        expect(status).toBe(1);
        expect(output).toContain(OLD_KEY);
        expect(output).toContain(FOOD_API);
        expect(output).toContain(definition(7));
        expect(output).toMatch(/redeploy/iu);
    });

    it('refuses while a deployment still IN FLIGHT names the retiring key, matched by value whatever the variable', () => {
        synthesized([2]);

        const { status, output } = run({
            ...FOOD_CLUSTER_FIXTURES,
            stackKeys: BOTH_DEPLOYED,
            'deployments.kitchensink-food-service-pr-91-FoodServiceCluster-AAA': deploymentsOf(
                definition(8),
                definition(7),
            ),
            'taskDefinition.kitchensinkfoodservicepr91FoodApiTaskDefinition:8': taskDefinitionWith({
                REMOTE_SEARCH_KEY_PAIR_ID: NEW_KEY,
            }),
            'taskDefinition.kitchensinkfoodservicepr91FoodApiTaskDefinition:7': taskDefinitionWith({
                SOME_RENAMED_VARIABLE: OLD_KEY,
            }),
        });

        expect(status).toBe(1);
        expect(output).toContain(definition(7));
    });

    it('allows it once every deployment signs with the new key, never reading an old revision no service runs', () => {
        synthesized([2]);

        const { status, calls } = run({
            ...FOOD_CLUSTER_FIXTURES,
            stackKeys: BOTH_DEPLOYED,
            'deployments.kitchensink-food-service-pr-91-FoodServiceCluster-AAA': deploymentsOf(definition(8)),
            'taskDefinition.kitchensinkfoodservicepr91FoodApiTaskDefinition:8': taskDefinitionWith({
                REMOTE_SEARCH_KEY_PAIR_ID: NEW_KEY,
            }),
            'taskDefinition.kitchensinkfoodservicepr91FoodApiTaskDefinition:7': taskDefinitionWith({
                REMOTE_SEARCH_KEY_PAIR_ID: OLD_KEY,
            }),
        });

        expect(status).toBe(0);
        expect(calls.filter((call) => call.startsWith('ecs describe-task-definition'))).toEqual([
            expect.stringContaining(definition(8)),
        ]);
    });

    it('reads only this application’s clusters: the account hosts another', () => {
        synthesized([2]);

        const { calls } = run({
            ...FOOD_CLUSTER_FIXTURES,
            stackKeys: BOTH_DEPLOYED,
            'deployments.kitchensink-food-service-pr-91-FoodServiceCluster-AAA': deploymentsOf(definition(8)),
            'taskDefinition.kitchensinkfoodservicepr91FoodApiTaskDefinition:8': taskDefinitionWith({}),
        });

        expect(calls.some((call) => call.includes(OTHER_APP_CLUSTER))).toBe(false);
        expect(calls.some((call) => call.startsWith('ecs list-services') && call.includes(FOOD_CLUSTER))).toBe(true);
    });
});

describe('remoteSearchKeyRetirement.sh — nothing to retire', () => {
    it('passes without reading ECS when the template keeps every deployed key (adding a generation, step 1)', () => {
        synthesized([1, 2]);

        const { status, calls } = run({ stackKeys: `SigningKey1PublicKeyA1B2C3D4\t${OLD_KEY}` });

        expect(status).toBe(0);
        expect(calls.filter((call) => call.startsWith('ecs'))).toEqual([]);
    });

    it('passes as a stated skip when the shared stack has never been deployed', () => {
        synthesized([1]);

        const { status, output, calls } = run(
            {},
            {
                STUB_STACK_ERROR: `An error occurred (ValidationError) when calling the ListStackResources operation: Stack with id ${STACK} does not exist`,
            },
        );

        expect(status).toBe(0);
        expect(output).toMatch(/not deployed/iu);
        expect(calls.filter((call) => call.startsWith('ecs'))).toEqual([]);
    });
});

describe('remoteSearchKeyRetirement.sh — a question it cannot answer is a refusal', () => {
    it('refuses when CloudFormation cannot be read', () => {
        synthesized([2]);

        const { status } = run(
            {},
            { STUB_STACK_ERROR: 'An error occurred (AccessDenied) when calling the ListStackResources operation' },
        );

        expect(status).toBe(1);
    });

    it('refuses when a running task definition cannot be read', () => {
        synthesized([2]);

        const { status } = run(
            {
                ...FOOD_CLUSTER_FIXTURES,
                stackKeys: BOTH_DEPLOYED,
                'deployments.kitchensink-food-service-pr-91-FoodServiceCluster-AAA': deploymentsOf(definition(7)),
            },
            { STUB_TASK_DEFINITION_ERROR: 'An error occurred (AccessDeniedException)' },
        );

        expect(status).toBe(1);
    });

    it('refuses when the assembly holds no template for the stack', () => {
        synthesized([2]);
        rmSync(join(assembly, 'shared.template.json'));

        const { status, calls } = run({ stackKeys: BOTH_DEPLOYED });

        expect(status).toBe(1);
        expect(calls).toEqual([]);
    });
});
