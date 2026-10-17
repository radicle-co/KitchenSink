import { CfnOutput, Stack, type StackProps, Tags, aws_ec2 as ec2 } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { albHttpsIngressPrefixListFor } from '@radicle-co/infra-shared/alb';
import { AcceptedNagFindings, acceptNagFindings } from '@radicle-co/infra-shared/security';

export interface NetworkStackProps extends StackProps {
    readonly stage: string;
}

/**
 * ⚠️ DELIBERATE — see docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md
 *
 * Per-stage VPC CIDRs. Prod stays on the historical 10.0.0.0/16 (so setting it
 * explicitly is a no-op against the deployed VPC — no replacement). Sandbox uses
 * a distinct range so the two VPCs can be peered (VPC peering rejects overlapping
 * CIDRs). Unknown/dev/test stages fall back to a throwaway range rather than
 * throwing, so local synth and the test harness keep working.
 *
 * Do NOT change the prod value: replacing the prod VPC replaces the prod RDS
 * (removalPolicy DESTROY, no snapshot). Gate any change on an empty `cdk diff`
 * for the whole prod network + data stacks.
 */
const STAGE_CIDRS: Record<string, string> = {
    prod: '10.0.0.0/16',
    sandbox: '10.1.0.0/16',
};

export function cidrForStage(stage: string): string {
    return STAGE_CIDRS[stage] ?? '10.2.0.0/16';
}

/**
 * ⚠️ DELIBERATE — the NAT AMI is PINNED, and replacing it is a reviewed change, not a side effect.
 *
 * `NatProvider.instanceV2` defaults `machineImage` to `AmazonLinuxImage(AL2023)`, which renders an SSM
 * parameter reference (`/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64`) that
 * CloudFormation resolves to whatever Amazon published most recently — at DEPLOY time, from a template that
 * did not change. On 2026-09-17 that turned a routine sandbox deploy into a replacement of the one instance
 * carrying the whole stage's egress (ADR-0004 accepts a single-AZ NAT as a cost/SPOF trade, which is
 * precisely why WHEN it is replaced must be a decision).
 *
 * This is the image the sandbox NAT was running when the fixed boot script was verified against it
 * (`al2023-ami-2023.12.20260917.1-kernel-6.1-arm64`, arm64, published 2026-09-17).
 *
 * **How it gets updated:** bump this constant in its own commit, understanding that the next deploy of EACH
 * stage replaces that stage's NAT instance and interrupts VPC-Lambda egress for the ~60 s the new box takes
 * to boot. Do it attended, not bundled with unrelated work.
 *
 * It is arm64 to match the `t4g` instance type below; `natInstanceBoot.test.ts` asserts that pairing,
 * because a mismatch synthesizes clean and only fails at launch.
 */
export const NAT_INSTANCE_AMI_US_EAST_1 = 'ami-0d50898f9b64253da';

/**
 * ⛔ The NAT instance's boot script. Every ordering choice here is a property of a real outage — read
 * `packages/infra/global/__tests__/natInstanceBoot.test.ts` before changing any line.
 *
 * The stock `NatInstanceProviderV2.DEFAULT_USER_DATA_COMMANDS` installs `iptables-services`, enables IP
 * forwarding, and only THEN adds the SNAT rule — using `route`, a net-tools binary AL2023 does not ship. On
 * a 512 MB `t4g.nano` the install was OOM-killed (`total-vm:1243368kB`, `anon-rss:174200kB` from the
 * instance's own console output), so forwarding came up while `/sbin/iptables` did not exist. The box
 * routed private-sourced packets to the IGW, which drops them, and reported `ok/ok` status checks for four
 * hours while every VPC-attached Lambda in the stage timed out.
 *
 * Four changes, each closing one link of that chain:
 *
 * 1. **Swap before the install.** A 1 GB FILE is a wide multiple of the 174 MB the killed process held
 *    (`anon-rss:174200kB`) on a 512 MB box, costs nothing,
 *    and does not need ADR-0004 reopened — a managed NAT Gateway (~$32/mo/stage) is refused there, and
 *    buying RAM via `t4g.micro` (~+$3/mo/stage) would not cover a future package that grows past 1 GB
 *    either. It is also written to `/etc/fstab`, because user data does not re-run on reboot.
 *    ⛔ "It already had swap" is the objection to pre-empt, and it is why this must be a FILE: `free` on the
 *    stock image reports 417 MB of swap, but `swapon --show` shows that is `/dev/zram0` — a COMPRESSED BLOCK
 *    DEVICE BACKED BY RAM. zram cannot rescue a process that exceeds physical memory, which is exactly why
 *    the install OOM-killed on a box that looked like it had swap. Disk-backed `/swapfile` is added with an
 *    explicit `pri=0`, which is below zram's `100`, so it is the overflow of last resort rather than the hot
 *    path. ⚠️ NOT `-2`: an earlier version set that and claimed it was explicit, but `man swapon`
 *    (util-linux 2.37.2) documents `--priority` as "a value between -1 and 32767", so `-2` is outside the
 *    documented range — it is the value the KERNEL assigns an unprioritised area, not one you can ask for.
 *    `0` is both explicit and documented, and orders identically against zram.
 *    ⚠️ Do NOT size this from `total-vm:1243368kB` in the kill log: that is VIRTUAL address space, not
 *    resident memory. The kill was total pressure on 512 MB, not one process needing 1.2 GB.
 * 2. **SNAT VERIFIED before forwarding — on this boot and every boot after.** The half-state is only
 *    reachable because `ip_forward=1` can succeed while
 *    the rule is missing. Enabling forwarding last means that window does not exist even transiently.
 * 3. **`ip` instead of `route`.** ⚠️ Stated precisely, because the obvious version of this claim is FALSE:
 *    `route` IS present on `ami-0d50898f9b64253da` (verified on the live box — `/usr/sbin/route`), so
 *    net-tools is not what broke on 2026-09-17. It is swapped anyway because it is the weaker of two
 *    assumptions: iproute2 is the base system's own tooling and `ip` is what `dnf` would keep, whereas
 *    net-tools is a legacy compatibility package that a future AL2023 image is free to drop — at which
 *    point the stock script resolves `$NF` from an empty command and SNATs on interface `""`.
 * 4. **A terminal assertion that HALTS.** ⚠️ `set -e` would NOT do this job: it aborts the script, but the
 *    instance still boots, still passes status checks, and the private route tables still point at it — a
 *    silent half-state that exited earlier. `poweroff` needs no credentials, cannot half-work, and makes the
 *    failure immediately visible (status checks vanish, the route blackholes).
 *    ⚠️ RESIDUAL, stated rather than hidden: this halts the BOX, it does not fail the DEPLOY. `Instance`
 *    carries no creation policy and nothing signals CloudFormation, so a future OOM yields a stopped NAT
 *    under a green `cdk deploy`. Closing that needs a `cfn-signal` retrofit through
 *    `natProvider.gatewayInstances` — deliberately NOT done here. The halt path is also UNEXERCISED: the
 *    repaired script was verified end-to-end on the live sandbox box, but nothing has yet driven the
 *    assertion to fail, so `poweroff` firing is reasoned, not observed.
 *
 * Rules are persisted with `iptables-save` rather than `service iptables save` for the same reason and with
 * the same caveat: `service` is also present today (`/usr/sbin/service`, verified), but it comes from
 * `initscripts` while `iptables-save` ships in the `iptables-utils` package the install above already pulls
 * in — one fewer package whose presence has to stay true.
 *
 * ⚠️ NOT done: skipping the install. Both `iptables` AND `nft` are ABSENT from the base AL2023 arm64 image
 * (verified on the live box before the repair: `ABSENT: iptables`, `ABSENT: nft`), so there is no shipped
 * binary to translate with and the install cannot be avoided — only afforded.
 *
 * @see docs/architecture/decisions/0004-minimize-nat-egress.md
 */
const NAT_BOOT_COMMANDS: readonly string[] = [
    // 1. Swap FIRST — the package install below is what OOM-killed on 512 MB.
    'if ! swapon --show | grep -q "^/swapfile"; then',
    '    fallocate -l 1G /swapfile',
    '    chmod 600 /swapfile',
    '    mkswap /swapfile',
    '    swapon --priority 0 /swapfile',
    'fi',
    'grep -q "^/swapfile " /etc/fstab || echo "/swapfile none swap sw,pri=0 0 0" >> /etc/fstab',
    // 2. Now the install can be afforded.
    'dnf install -y iptables-services',
    'systemctl enable --now iptables',
    // 3. Translation BEFORE forwarding, off an interface name iproute2 can actually produce.
    'NAT_INTERFACE="$(ip -o -4 route show to default | awk \'{print $5}\')"',
    '/sbin/iptables -t nat -A POSTROUTING -o "$NAT_INTERFACE" -j MASQUERADE',
    '/sbin/iptables -F FORWARD',
    '/sbin/iptables-save > /etc/sysconfig/iptables',
    // 4. ASSERT BEFORE FORWARDING, so the box only ever forwards where SNAT is VERIFIED present — on this
    //    boot AND on every boot after it, because the drop-in below is never written on the failure path.
    //
    //    ⛔ THE ORDER OF THESE TWO STEPS IS THE WHOLE FIX, and getting it backwards is what review caught.
    //    There is deliberately no `set -e` (see the header), so an OOM-killed install still REACHES the
    //    `ip_forward` drop-in and writes it PERSISTENTLY. `poweroff` then halts a box whose stored config
    //    says "forward" with no SNAT — and the operator's reflex, starting it again, preserves the instance
    //    id, so cloud-init's once-per-instance `scripts-user` never re-runs while `systemd-sysctl` faithfully
    //    restores forwarding. The 2026-09-17 half-state, rebuilt by the recovery action itself.
    //
    //    ⛔ `exit 1` IS LOAD-BEARING, NOT TIDINESS. `poweroff` signals systemd and RETURNS, so a bare
    //    `|| poweroff` with anything after it races the shutdown and can still write the drop-in.
    '/sbin/iptables -t nat -C POSTROUTING -o "$NAT_INTERFACE" -j MASQUERADE || { poweroff; exit 1; }',
    // 5. Only now is forwarding safe to enable — there is no window, on any boot, where it routes without
    //    translating.
    'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/custom-ip-forwarding.conf',
    'sysctl -p /etc/sysctl.d/custom-ip-forwarding.conf',
];

/**
 * @implements REQ-050 REQ-IF-007 REQ-CN-007 FR-038 ARCH-031 MOD-031
 */
export class NetworkStack extends Stack {
    public readonly vpc: ec2.Vpc;
    public readonly albSecurityGroup: ec2.SecurityGroup;
    public readonly serviceSecurityGroup: ec2.SecurityGroup;
    public readonly databaseSecurityGroup: ec2.SecurityGroup;
    public readonly lambdaSecurityGroup: ec2.SecurityGroup;

    public constructor(scope: Construct, id: string, props: NetworkStackProps) {
        super(scope, id, props);

        // Cost: a managed NAT *Gateway* is ~$32/mo/stage + data; a NAT *instance* (t4g.nano) is ~$3-4/mo
        // for the same job at this scale. The single remaining NAT consumer is the DB-bound webhook
        // lambda set (they must be VPC-attached to reach the private RDS, then need Secrets/Logs/SQS/
        // Clerk egress); everything else (Fargate services, log-forwarder) egresses via the IGW and
        // does not touch the NAT. Single-AZ instance is an accepted SPOF/throughput trade for a lean
        // stage. OUTBOUND_ONLY by default; inbound is opened only to the VPC CIDR below.
        //
        // The image is PINNED and the boot script is OURS — see `NAT_INSTANCE_AMI_US_EAST_1` and
        // `NAT_BOOT_COMMANDS`. The provider's own defaults for both took sandbox egress down on
        // 2026-09-17 and leave every stage one AMI publication away from the same outage.
        const natUserData = ec2.UserData.forLinux();

        natUserData.addCommands(...NAT_BOOT_COMMANDS);

        const natProvider = ec2.NatProvider.instanceV2({
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
            defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
            machineImage: ec2.MachineImage.genericLinux({ 'us-east-1': NAT_INSTANCE_AMI_US_EAST_1 }),
            userData: natUserData,
        });

        this.vpc = new ec2.Vpc(this, 'Vpc', {
            ipAddresses: ec2.IpAddresses.cidr(cidrForStage(props.stage)),
            maxAzs: 2,
            natGateways: 1,
            natGatewayProvider: natProvider,
            subnetConfiguration: [
                {
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'private-app',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
                {
                    name: 'private-data',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                },
            ],
        });

        // The NAT instance defaults to OUTBOUND_ONLY; open inbound only to the VPC CIDR so the
        // private subnets can route their egress through it (and nothing on the public internet can).
        natProvider.connections.allowFrom(
            ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
            ec2.Port.allTraffic(),
            'Allow VPC private subnets to route egress through the NAT instance',
        );

        // Platform-wide VPC name (shared across services) — overrides the CDK
        // path-derived Name tag. Scoped to the VPC resource only (not its subnets/
        // route tables, which keep their distinct names). Tag-only change; no replacement.
        Tags.of(this.vpc.node.defaultChild as ec2.CfnVPC).add('Name', `KitchenSink-${props.stage}`);

        this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
            vpc: this.vpc,
            description: 'Ingress boundary for identity ALB',
            allowAllOutbound: true,
        });

        this.serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
            vpc: this.vpc,
            description: 'ECS tasks for identity service',
            allowAllOutbound: false,
        });

        this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
            vpc: this.vpc,
            description: 'Lambda functions in webhooks boundary',
            allowAllOutbound: false,
        });

        this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
            vpc: this.vpc,
            description: 'RDS PostgreSQL ingress boundary',
            allowAllOutbound: true,
        });

        // ⛔ ALL ALB ingress is owned HERE, and nowhere else. `SharedAlbStack` passes `open: false` to its
        // listeners for exactly this reason: `open: true` calls `allowDefaultPortFrom(anyIpv4())` on THIS
        // security-group construct, which is invisible while the rules happen to be identical and silently
        // re-opens `:443` in a DIFFERENT stack's template the moment this one narrows. See the U17 lockdown
        // block in `SharedAlbStack.test.ts` for the assertion that catches it.
        //
        // `:80` stays open to the internet on every stage. It only redirects to `:443`, so it protects
        // nothing — and a second managed-prefix-list rule would cost another 55 against the 60-rule quota
        // and fail the deploy outright (see CLOUDFRONT_PREFIX_LIST_RULE_WEIGHT).
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Public HTTP ingress');

        // Prod's ALB answers only to CloudFront (ADR-0020 / U17). Every other stage has no distribution and
        // must keep reaching its own ALB directly, so `undefined` — the absence of a prefix list — is the
        // prod gate rather than a second stage comparison written out here.
        const httpsIngressPrefixList = albHttpsIngressPrefixListFor(props.stage);

        if (httpsIngressPrefixList === undefined) {
            this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Public HTTPS ingress');
        } else {
            this.albSecurityGroup.addIngressRule(
                ec2.Peer.prefixList(httpsIngressPrefixList),
                ec2.Port.tcp(443),
                'CloudFront origin-facing only (ADR-0020 / U17)',
            );
        }

        // AwsSolutions-EC23 accepted: this SG fronts the shared INTERNET-FACING ALB (ADR-0003), so public
        // ingress here is the resource doing its job. Justification in @radicle-co/infra-shared/security.
        acceptNagFindings(this.albSecurityGroup, AcceptedNagFindings.PUBLIC_ALB_INGRESS_IS_THE_INGRESS_BOUNDARY);

        this.serviceSecurityGroup.addIngressRule(
            this.albSecurityGroup,
            ec2.Port.tcp(3000),
            'Allow ALB to reach identity ECS tasks',
        );

        this.serviceSecurityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Controlled egress for Clerk API and AWS endpoints',
        );

        this.lambdaSecurityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Controlled egress for Clerk API and AWS endpoints',
        );

        this.databaseSecurityGroup.addIngressRule(
            this.serviceSecurityGroup,
            ec2.Port.tcp(5432),
            'Allow identity ECS tasks to reach PostgreSQL',
        );

        this.databaseSecurityGroup.addIngressRule(
            this.lambdaSecurityGroup,
            ec2.Port.tcp(5432),
            'Allow webhook lambdas to reach PostgreSQL',
        );

        // The app SGs use allowAllOutbound: false, so the DB ingress rules above are not enough —
        // the source SGs also need explicit *egress* to PostgreSQL or the SYN never leaves the ENI
        // (ENI_SG_RULES_MISMATCH / connection timeout). Pair every DB ingress with matching egress.
        this.serviceSecurityGroup.addEgressRule(
            this.databaseSecurityGroup,
            ec2.Port.tcp(5432),
            'Allow identity ECS tasks to reach PostgreSQL',
        );

        this.lambdaSecurityGroup.addEgressRule(
            this.databaseSecurityGroup,
            ec2.Port.tcp(5432),
            'Allow webhook lambdas to reach PostgreSQL',
        );

        const privateSubnets = this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds;
        const privateDataSubnets = this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds;

        new CfnOutput(this, 'VpcId', {
            value: this.vpc.vpcId,
            exportName: `${this.stackName}:VpcId`,
        });
        new CfnOutput(this, 'PrivateAppSubnetIds', {
            value: privateSubnets.join(','),
            exportName: `${this.stackName}:PrivateAppSubnetIds`,
        });
        new CfnOutput(this, 'PrivateDataSubnetIds', {
            value: privateDataSubnets.join(','),
            exportName: `${this.stackName}:PrivateDataSubnetIds`,
        });
        new CfnOutput(this, 'AlbSecurityGroupId', {
            value: this.albSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:AlbSecurityGroupId`,
        });
        new CfnOutput(this, 'ServiceSecurityGroupId', {
            value: this.serviceSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:ServiceSecurityGroupId`,
        });
        new CfnOutput(this, 'DatabaseSecurityGroupId', {
            value: this.databaseSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:DatabaseSecurityGroupId`,
        });
        new CfnOutput(this, 'LambdaSecurityGroupId', {
            value: this.lambdaSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:LambdaSecurityGroupId`,
        });
    }
}
