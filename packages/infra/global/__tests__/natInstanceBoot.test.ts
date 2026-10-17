// @vitest-environment node
/**
 * ⛔ THE NAT INSTANCE MUST NEVER BOOT INTO A FORWARDING-BUT-NOT-TRANSLATING BLACK HOLE.
 *
 * ## The outage this gate is written from (sandbox, 2026-09-17T23:58Z)
 *
 * `NetworkStack` asked for `ec2.NatProvider.instanceV2({ instanceType: t4g.NANO })`. That provider defaults
 * `machineImage` to `AmazonLinuxImage(AL2023)`, which resolves through an SSM public parameter at DEPLOY
 * time — so the AMI is whatever Amazon published most recently, and an unrelated deploy REPLACES the one
 * instance that is the whole stage's egress path. AL2023 published
 * `al2023-ami-2023.12.20260917.1-kernel-6.1-arm64` that day, a routine sandbox deploy picked it up, and the
 * NAT instance was replaced.
 *
 * The provider's shipped user data then ran on 512 MB of RAM, in this order:
 *
 * ```
 * yum install iptables-services -y
 * systemctl enable iptables ; systemctl start iptables
 * echo "net.ipv4.ip_forward=1" > … ; sysctl -p …
 * sudo /sbin/iptables -t nat -A POSTROUTING -o $(route | awk '/^default/{print $NF}') -j MASQUERADE
 * ```
 *
 * From the instance's own console output:
 *
 * ```
 * yum invoked oom-killer: … task=yum,pid=1621
 * Out of memory: Killed process 1621 (yum) total-vm:1243368kB, anon-rss:174200kB
 * Failed to enable unit: Unit file iptables.service does not exist.
 * net.ipv4.ip_forward = 1            <-- SUCCEEDED
 * sudo: /sbin/iptables: command not found   <-- the MASQUERADE rule never ran
 * ```
 *
 * The box came up **forwarding but not translating**: private-sourced packets were routed to the IGW, which
 * drops them. Every VPC-attached Lambda in the stage got `connect ETIMEDOUT` for four hours. EC2 status
 * checks stayed `ok/ok` the entire time, because from the hypervisor's point of view nothing was wrong.
 *
 * ⚠️ `route` was NOT the cause and is NOT missing — `/usr/sbin/route` exists on that image, verified on the
 * live instance. The install is the only thing that failed. `route` is replaced here on the weaker-assumption
 * argument in `NetworkStack`'s own note, not on a claim about this outage.
 *
 * ## What is asserted, and why each rule is a property of THAT failure
 *
 * {@link natBootDefects} is a pure verdict over the shell commands the instance actually boots with, read
 * back out of the synthesized template rather than from a constant, so it judges what deploys. Each code
 * closes one link in the chain above:
 *
 * | Code                            | The link it breaks                                                       |
 * | ------------------------------- | ------------------------------------------------------------------------ |
 * | `noSwapBeforePackageInstall`    | the install is what OOMed; 1 GB of swap covers a 1.2 GB `total-vm` peak   |
 * | `forwardingEnabledBeforeSnat`   | forwarding came up first, which is what made the half-state REACHABLE     |
 * | `noHaltingSnatAssertion`        | nothing checked the rule landed, so the half-state was SILENT             |
 * | `interfaceResolvedWithNetTools` | `route` is legacy net-tools the image is free to drop — a second landmine |
 * | `noIproute2InterfaceLookup`     | …so the interface comes from `ip`, the base system's own tooling          |
 * | `noSnatRule`                    | the rule itself, so the suite cannot pass by deleting the thing it checks |
 * | `noRulePersistence`             | user data does not re-run on reboot; only a saved ruleset survives one    |
 *
 * ⚠️ `set -e` is deliberately NOT what makes this loud, and adding it would be a REGRESSION. `errexit`
 * aborts the script — the instance still boots, still passes its status checks, and CloudFormation still
 * points the private route tables at it. It converts a silent half-state into a silent half-state that
 * exited earlier. Only an action that changes the box's observable state (here: `poweroff`, which needs no
 * credentials and cannot half-work) turns this class of failure into something an operator can see.
 *
 * ## Why the negative control is the real CDK default
 *
 * Firing the predicate at a hand-written fake would only prove it can go red at something. It is fired at
 * `NatInstanceProviderV2.DEFAULT_USER_DATA_COMMANDS` — the exact code that caused the outage, straight out
 * of the installed `aws-cdk-lib` — so the gate is proven to detect the real defect, and it will re-detect it
 * if a future refactor drops back to the default.
 *
 * ⚠️ FIVE of the seven codes fire on that control, not all seven — do not read the table above as "every
 * code is a property of the outage". `noSnatRule` and `noRulePersistence` are satisfied by the stock script
 * too, so the outage never tested them; they are properties of THIS script, guarding the two ways a future
 * edit could pass every other rule and still ship a box that never translates, or one that stops translating
 * at its first reboot. The third test below ('goes red when the halting assertion is dropped') is what proves
 * the codes can fire INDEPENDENTLY rather than only as the default's fixed bundle.
 *
 * DESIGN PATTERN: Specification module over the synthesized template — {@link natBootDefects} is a pure
 * verdict over a command list, fired at both the deployed script and a known-violating one.
 */
import { Template } from 'aws-cdk-lib/assertions';
import { NatInstanceProviderV2 } from 'aws-cdk-lib/aws-ec2';
import { describe, expect, it } from 'vitest';

import { NAT_INSTANCE_AMI_US_EAST_1, NetworkStack } from '../lib/platform/NetworkStack.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };

/** Every way the NAT boot script can leave the instance unable to translate, or unable to say so. */
export type NatBootDefect =
    | 'noSwapBeforePackageInstall'
    | 'interfaceResolvedWithNetTools'
    | 'noIproute2InterfaceLookup'
    | 'noSnatRule'
    | 'forwardingEnabledBeforeSnat'
    | 'forwardingEnabledBeforeAssertion'
    | 'noIpForwardingEnabled'
    | 'noHaltingSnatAssertion'
    | 'noRulePersistence';

const PACKAGE_INSTALL = /\b(?:dnf|yum)\s+install\b/;
const SWAP_ENABLED = /\bswapon\b/;
const NET_TOOLS_ROUTE = /\broute\s*\|\s*awk\b/;
const IPROUTE2_DEFAULT_ROUTE = /\bip\s+-o\s+-4\s+route\s+show\s+to\s+default\b/;
const SNAT_ADD = /iptables\s+-t\s+nat\s+-A\s+POSTROUTING\b.*-j\s+MASQUERADE/;
const SNAT_CHECK = /iptables\s+-t\s+nat\s+-C\s+POSTROUTING\b.*-j\s+MASQUERADE/;
const HALT_ON_FAILURE = /\|\|\s*(?:\{\s*)?(?:poweroff|shutdown\s+-h)\b/;
const IP_FORWARD_ENABLED = /net\.ipv4\.ip_forward\s*=\s*1/;
const RESTORE_AT_BOOT = /systemctl\s+enable\b.*\biptables\b/;
const RULESET_SAVED = /\biptables-save\b|\bservice\s+iptables\s+save\b/;

/**
 * The index of the first command matching `pattern`, or `Number.MAX_SAFE_INTEGER` when none does.
 *
 * The absent case sorts LAST on purpose: every ordering rule below reads "X must come before Y", and a
 * missing X must fail that comparison rather than pass it by being index `-1`.
 *
 * @param commands - The boot script, one shell command per entry.
 * @param pattern - What to look for.
 * @returns The index, or `Number.MAX_SAFE_INTEGER`.
 */
function firstIndexOf(commands: readonly string[], pattern: RegExp): number {
    const index = commands.findIndex((command) => pattern.test(command));

    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Judges a NAT instance boot script against every link in the 2026-09-17 failure chain.
 *
 * @param commands - The shell commands the instance boots with, in order.
 * @returns The defects found, in a stable order. Empty means the script cannot reach the half-state.
 */
export function natBootDefects(commands: readonly string[]): NatBootDefect[] {
    const defects: NatBootDefect[] = [];

    const swapAt = firstIndexOf(commands, SWAP_ENABLED);
    const installAt = firstIndexOf(commands, PACKAGE_INSTALL);
    const snatAddAt = firstIndexOf(commands, SNAT_ADD);
    const snatCheckAt = firstIndexOf(commands, SNAT_CHECK);
    const forwardingAt = firstIndexOf(commands, IP_FORWARD_ENABLED);

    if (installAt !== Number.MAX_SAFE_INTEGER && swapAt > installAt) {
        defects.push('noSwapBeforePackageInstall');
    }

    if (commands.some((command) => NET_TOOLS_ROUTE.test(command))) {
        defects.push('interfaceResolvedWithNetTools');
    }

    if (!commands.some((command) => IPROUTE2_DEFAULT_ROUTE.test(command))) {
        defects.push('noIproute2InterfaceLookup');
    }

    if (snatAddAt === Number.MAX_SAFE_INTEGER) {
        defects.push('noSnatRule');
    }

    if (forwardingAt < snatAddAt) {
        defects.push('forwardingEnabledBeforeSnat');
    }

    if (snatCheckAt < snatAddAt || !HALT_ON_FAILURE.test(commands[snatCheckAt] ?? '')) {
        defects.push('noHaltingSnatAssertion');
    }

    // ⛔ FORWARDING MUST BE ENABLED ONLY AFTER SNAT IS *VERIFIED*, not merely after it is ATTEMPTED. The
    // script carries no `set -e` on purpose, so a failed install still reaches the `ip_forward` drop-in and
    // writes it PERSISTENTLY. `poweroff` then halts a box whose stored config says "forward", and the
    // operator's reflex — start it again — preserves the instance id, so cloud-init's once-per-instance
    // `scripts-user` never re-runs while `systemd-sysctl` restores forwarding. That is the 2026-09-17
    // half-state restored by the recovery action, which is why ordering alone is not enough.
    //
    // The `!== MAX` guard keeps this from firing on a script that has NO assertion at all — that case is
    // already named by `noHaltingSnatAssertion`, and double-reporting it would change the negative control.
    if (snatCheckAt !== Number.MAX_SAFE_INTEGER && forwardingAt < snatCheckAt) {
        defects.push('forwardingEnabledBeforeAssertion');
    }

    // ⚠️ `forwardingEnabledBeforeSnat` is VACUOUS once the order is right (`MAX < snatAddAt` is false), so a
    // script that silently stopped enabling forwarding at all would pass every other predicate. After the
    // reorder the enable sits near the tail, where an edit can drop it unnoticed — a NAT that never forwards
    // is broken in the other direction.
    if (forwardingAt === Number.MAX_SAFE_INTEGER) {
        defects.push('noIpForwardingEnabled');
    }

    const persists =
        commands.some((command) => RESTORE_AT_BOOT.test(command)) &&
        commands.some((command) => RULESET_SAVED.test(command));

    if (!persists) {
        defects.push('noRulePersistence');
    }

    return defects;
}

/** The single `AWS::EC2::Instance` in a `NetworkStack` template — the stage's one NAT box (ADR-0004). */
function natInstanceProperties(stage: string): Record<string, unknown> {
    const template = Template.fromStack(new NetworkStack(testApp(), `Net-${stage}`, { env, stage }));
    const instances = Object.values(template.findResources('AWS::EC2::Instance'));

    expect(instances).toHaveLength(1);

    return (instances[0] as { Properties: Record<string, unknown> }).Properties;
}

/** The boot script the deployed NAT instance actually runs, one command per entry. */
function natBootCommands(stage: string): string[] {
    const userData = natInstanceProperties(stage)['UserData'] as { 'Fn::Base64': string };

    // Unresolved tokens would come back as an object, which is itself a finding: this gate can only judge a
    // script it can read, so a token-bearing user data must fail here rather than be silently skipped.
    expect(typeof userData['Fn::Base64']).toBe('string');

    return userData['Fn::Base64'].split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#!'));
}

describe('NAT instance boot script', () => {
    for (const stage of ['prod', 'sandbox'] as const) {
        it(`cannot leave the ${stage} NAT forwarding without translating`, () => {
            expect(natBootDefects(natBootCommands(stage))).toEqual([]);
        });
    }

    it('detects every link of the 2026-09-17 chain in the CDK default it replaces', () => {
        // The negative control is the shipped `NatInstanceProviderV2` user data — the literal code that took
        // sandbox egress down — so this suite is proven to go red at the real defect, not merely at a fake.
        expect(natBootDefects(NatInstanceProviderV2.DEFAULT_USER_DATA_COMMANDS)).toEqual([
            'noSwapBeforePackageInstall',
            'interfaceResolvedWithNetTools',
            'noIproute2InterfaceLookup',
            'forwardingEnabledBeforeSnat',
            'noHaltingSnatAssertion',
        ]);
    });

    it('goes red when the halting assertion is dropped but everything else is right', () => {
        const withoutAssertion = natBootCommands('sandbox').filter((command) => !SNAT_CHECK.test(command));

        expect(natBootDefects(withoutAssertion)).toEqual(['noHaltingSnatAssertion']);
    });

    /**
     * ⛔ THE PREDICATE FOR THE ACTUAL BLOCKER, OBSERVED RED. `forwardingEnabledBeforeAssertion` is the only
     * code that catches a re-regression of the ordering this file exists to enforce, and NOTHING above can
     * fire it: the negative control has no assertion at all, so the `snatCheckAt !== MAX` guard suppresses
     * it, and the test above FILTERS the assertion out, which suppresses it too. A predicate the suite never
     * watches fail has proved nothing — the house rule this file is otherwise built on.
     *
     * The mutation is the real regression: move the assertion to the END, i.e. back to enabling forwarding
     * before it is verified, which is exactly the state that let a halted NAT be restarted into a
     * forwarding-without-translating box.
     */
    it('goes red when forwarding is enabled BEFORE the assertion rather than after', () => {
        const commands = natBootCommands('sandbox');
        const check = commands.findIndex((command) => SNAT_CHECK.test(command));

        expect(check).toBeGreaterThan(-1);

        const reordered = [...commands.slice(0, check), ...commands.slice(check + 1), commands[check] as string];

        expect(natBootDefects(reordered)).toEqual(['forwardingEnabledBeforeAssertion']);
    });

    /**
     * ⚠️ AND THE OPPOSITE FAILURE, which `forwardingEnabledBeforeSnat` cannot see. Once the order is right
     * that older predicate is vacuous (`MAX < snatAddAt` is false), so a script that silently stopped
     * enabling forwarding at all would pass every other code — and after the reorder the enable sits near
     * the tail, where an edit can drop it unnoticed. A NAT that never forwards is broken the other way.
     */
    it('goes red when forwarding is never enabled at all', () => {
        const withoutForwarding = natBootCommands('sandbox').filter((command) => !IP_FORWARD_ENABLED.test(command));

        expect(natBootDefects(withoutForwarding)).toEqual(['noIpForwardingEnabled']);
    });
});

describe('NAT instance image', () => {
    for (const stage of ['prod', 'sandbox'] as const) {
        it(`pins ${stage}'s AMI to a literal id, so replacing the stage's only egress path is deliberate`, () => {
            // An `AmazonLinuxImage` renders an SSM parameter reference that CloudFormation resolves to the
            // LATEST published AMI on every deploy — which is how an unrelated sandbox deploy replaced the
            // NAT instance and took egress with it. A literal id makes the replacement a reviewable diff.
            expect(natInstanceProperties(stage)['ImageId']).toBe(NAT_INSTANCE_AMI_US_EAST_1);
        });

        it(`keeps ${stage}'s instance type on the arm64 family the pinned AMI is built for`, () => {
            // Pinning couples the image to the architecture: the pinned AMI is arm64, so a change to an x86
            // instance type would synthesize clean and fail at launch, with no egress until someone noticed.
            expect(natInstanceProperties(stage)['InstanceType']).toMatch(/^t4g\./);
        });
    }

    it('pins an id of the documented shape, not a placeholder', () => {
        expect(NAT_INSTANCE_AMI_US_EAST_1).toMatch(/^ami-[0-9a-f]{17}$/);
    });
});
