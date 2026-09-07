// @vitest-environment node
/**
 * ⛔ THE ENGINE-VERSION GATE for the shared RDS instance (plan U13, R48/R49).
 *
 * ## Why this file exists, and why no existing gate covers it
 *
 * `cdkNagTemplateParity.test.ts` is the repo's template-diff discipline, and it **structurally cannot fire
 * on an engine-version change**: it synthesizes the SAME source twice — once with the security Aspect
 * attached, once without — and compares the two. Both halves move together when `DataStack`'s
 * `PostgresEngineVersion` moves, so the comparison stays byte-identical and stays green. The prod template
 * would change underneath a passing suite.
 *
 * That matters more here than anywhere else in the tree. The instance this gate watches carries
 * `kitchensink_identity` — live production user data — plus `kitchensink_food`, `kitchensink_recipes`, and
 * every per-PR logical database (ADR-0006). It is single-AZ with no replica, `removalPolicy: DESTROY`, and
 * takes **no safety snapshot**; `deletionProtection` (asserted by `DataStack.test.ts`, not restated here) is
 * the only thing standing between an accidental replacement and total loss. ADR-0002 is the record of how
 * close that hazard sits to an ordinary-looking CDK edit.
 *
 * And a PostgreSQL MAJOR version cannot be rolled back in place. "Fix forward only" — the recovery posture
 * ADR-0002 prescribes for a wedged data stack — is **not available** for this one property. The only
 * recovery is restoring the pre-upgrade snapshot into a NEW instance, which CloudFormation does not own.
 * `docs/runbooks/pg18-upgrade.md` carries that restore leg. This gate is what keeps anyone from taking that
 * one-way step by accident.
 *
 * ## ⚠️ Why an EXPECTED CONSTANT and not "fails on any change"
 *
 * The obvious gate — snapshot the current version, fail when it moves — is the wrong one, and the reason is
 * that the change it would fire on is the one this very unit makes. A gate nobody can satisfy leaves CI
 * permanently red with no way to land the intended upgrade, and the only move available to whoever meets it
 * is to DELETE it. A gate that invites its own deletion at the exact moment it starts mattering is worse
 * than no gate, because it also spends the reviewer's attention.
 *
 * So the expected version is a committed constant, reviewed in the diff that moves it. Drift still fails —
 * changing `PostgresEngineVersion` without touching {@link EXPECTED_ENGINE_VERSION} is exactly what this
 * catches — while an INTENDED move is a two-line diff a reviewer can see and argue with.
 *
 * ⚠️ The pairing is deliberate and must stay: {@link EXPECTED_ENGINE_VERSION} lives HERE and the engine
 * lives in `DataStack.ts`. A gate that read the version out of `DataStack` would agree with it by
 * construction and assert nothing — which is precisely the mistake `localPostgresParity.test.ts` makes on
 * PURPOSE and for the opposite reason: that gate READS the RDS major so local Docker images FOLLOW the
 * engine, and this one RESTATES it so the engine cannot move unreviewed. Two gates, opposite directions,
 * and together they mean moving the engine is one deliberate edit that drags every Postgres pin in the repo
 * along with it.
 *
 * ## What else is asserted, and why each is an outage rather than a nit
 *
 *   - **`AllowMajorVersionUpgrade`** — without it RDS refuses the 16 → 18 transition outright. Dropped
 *     between review and deploy, the failure surfaces INSIDE the scheduled maintenance window, against a
 *     production instance, with the snapshot already taken and the service already suppressed.
 *   - **`AutoMinorVersionUpgrade`** — the version pin is major-only on purpose, so the minor floats and RDS
 *     tracks the 18 series' patches. Losing this silently strands the instance on whichever minor it landed
 *     on, which is a security-patch decision made by accident.
 *   - **No custom `DBParameterGroupName`.** This is AWS's own most-cited way for this exact deploy to fail.
 *     Parameter-group families are version-pinned (`postgres16` vs `postgres18`) and `ModifyDBInstance`
 *     requires the group to be "in the same DB parameter group family as the DB instance" — while `Family`
 *     on `AWS::RDS::DBParameterGroup` is immutable, so a custom group must be REPLACED, at a new logical id,
 *     in the same change set as the version bump. `DataStack` deliberately sets none, which is what makes
 *     this upgrade a one-property change; RDS then moves the default group with the engine. This assertion
 *     is not a prohibition on ever having one — it is the prompt to handle the family swap when someone
 *     adds it, instead of discovering it mid-outage.
 *   - **Every stage carries the same version.** Nothing in `DataStack` branches the engine per stage today,
 *     and R54's sandbox-first sequencing is an OPERATIONAL order (deploy sandbox, soak, then deploy prod),
 *     never a per-stage constant. A conditional introduced here would let prod and sandbox diverge
 *     permanently while both templates synthesize clean.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link engineFaults} is a pure verdict over
 * one synthesized instance's properties, fired at deliberately-violating fakes below as well as at the real
 * templates, so the suite proves it can DETECT the absence of what it asserts.
 */
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';

/**
 * The PostgreSQL major version this repository has REVIEWED and intends to run.
 *
 * ⛔ Moving this is a one-way door. A major version cannot be downgraded in place; recovery is a snapshot
 * restore into a new instance. Move it only alongside `DataStack`'s `PostgresEngineVersion`, and only with
 * `docs/runbooks/pg18-upgrade.md` executed — snapshot verified, window scheduled, restore leg rehearsed.
 */
const EXPECTED_ENGINE_VERSION = '18';

/** Stages whose synthesized data stack this gate reads. Prod is the one that carries user data. */
const STAGES = ['prod', 'sandbox'] as const;

const env = { account: '123456789012', region: 'us-east-1' };

/** The `AWS::RDS::DBInstance` properties this gate reads. Everything is `unknown` — the template is data. */
interface EngineProperties {
    readonly Engine?: unknown;
    readonly EngineVersion?: unknown;
    readonly AllowMajorVersionUpgrade?: unknown;
    readonly AutoMinorVersionUpgrade?: unknown;
    readonly DBParameterGroupName?: unknown;
}

/**
 * Render a template value for a failure message without `JSON.stringify` swallowing `undefined`.
 *
 * @param value - The property value as synthesized.
 * @returns A readable rendering. Pure.
 */
function render(value: unknown): string {
    return value === undefined ? 'absent' : JSON.stringify(value);
}

/**
 * Everything wrong with one synthesized DB instance, as readable sentences.
 *
 * Returns ALL faults rather than the first, so a failure reports the whole picture instead of one property
 * at a time across successive CI runs.
 *
 * @param properties - The instance's synthesized CloudFormation properties.
 * @param expected - The reviewed engine version.
 * @returns One sentence per fault; empty when the instance is correct. Pure.
 */
function engineFaults(properties: EngineProperties, expected: string): readonly string[] {
    const faults: string[] = [];

    if (properties.Engine !== 'postgres') {
        faults.push(`Engine is ${render(properties.Engine)}, not postgres`);
    }

    if (properties.EngineVersion !== expected) {
        faults.push(
            `EngineVersion is ${render(properties.EngineVersion)} against the reviewed ${expected} — ` +
                'a major version cannot be downgraded in place',
        );
    }

    if (properties.AllowMajorVersionUpgrade !== true) {
        faults.push(
            `AllowMajorVersionUpgrade is ${render(properties.AllowMajorVersionUpgrade)} — ` +
                'RDS refuses a major transition without it, inside the maintenance window',
        );
    }

    if (properties.AutoMinorVersionUpgrade !== true) {
        faults.push(
            `AutoMinorVersionUpgrade is ${render(properties.AutoMinorVersionUpgrade)} — ` +
                'the version pin is major-only so the minor must float',
        );
    }

    if (properties.DBParameterGroupName !== undefined) {
        faults.push(
            `DBParameterGroupName is ${render(properties.DBParameterGroupName)} — ` +
                'parameter-group families are version-pinned, so a custom group must be REPLACED in the ' +
                'same change set as a major version bump',
        );
    }

    return faults;
}

/**
 * Every DB instance in a stage's synthesized data stack.
 *
 * @param stage - The stage to synthesize.
 * @returns One entry per `AWS::RDS::DBInstance`, each carrying its logical id so a failure names the resource.
 * @sideEffect Synthesizes a CDK app.
 */
function synthesizedInstances(stage: string): readonly { readonly logicalId: string; properties: EngineProperties }[] {
    const app = new App();
    const network = new NetworkStack(app, `Net-${stage}`, { env, stage });
    const data = new DataStack(app, `Data-${stage}`, { env, network, stage });

    return Object.entries(Template.fromStack(data).findResources('AWS::RDS::DBInstance')).map(
        ([logicalId, resource]) => ({
            logicalId,
            properties: (resource as { Properties?: EngineProperties }).Properties ?? {},
        }),
    );
}

describe('the shared RDS engine version cannot move unreviewed', () => {
    it.each(STAGES)('synthesizes the reviewed engine and upgrade flags for %s', (stage) => {
        const instances = synthesizedInstances(stage);

        expect(
            instances.length,
            `no AWS::RDS::DBInstance found in kitchensink-data-${stage} — this gate has stopped reading anything`,
        ).toBeGreaterThan(0);

        expect(
            instances.flatMap(({ logicalId, properties }) =>
                engineFaults(properties, EXPECTED_ENGINE_VERSION).map((fault) => `${stage}/${logicalId}: ${fault}`),
            ),
            'The shared instance carries kitchensink_identity — live production user data — single-AZ, no ' +
                'replica, removalPolicy DESTROY, no safety snapshot. Move EXPECTED_ENGINE_VERSION only with ' +
                'docs/runbooks/pg18-upgrade.md executed.',
        ).toEqual([]);
    });

    it('keeps every stage on the same engine version, so prod and sandbox cannot diverge', () => {
        const versions = STAGES.flatMap((stage) =>
            synthesizedInstances(stage).map(({ properties }) => `${stage}=${render(properties.EngineVersion)}`),
        );

        expect(new Set(versions.map((entry) => entry.split('=')[1])).size, versions.join(', ')).toBe(1);
    });
});

describe('the engine-version verdict detects the absence of what it asserts', () => {
    /** A correct instance, as the negative controls' starting point. */
    const correct: EngineProperties = {
        Engine: 'postgres',
        EngineVersion: EXPECTED_ENGINE_VERSION,
        AllowMajorVersionUpgrade: true,
        AutoMinorVersionUpgrade: true,
    };

    it('passes a correct instance', () => {
        expect(engineFaults(correct, EXPECTED_ENGINE_VERSION)).toEqual([]);
    });

    it('fails an engine version that drifted from the reviewed constant', () => {
        expect(engineFaults({ ...correct, EngineVersion: '16' }, EXPECTED_ENGINE_VERSION).join(' ')).toContain(
            'EngineVersion is "16"',
        );
    });

    it('fails a MINOR-pinned version, which would freeze the instance off the floating 18 series', () => {
        expect(engineFaults({ ...correct, EngineVersion: '18.1' }, EXPECTED_ENGINE_VERSION).join(' ')).toContain(
            'EngineVersion is "18.1"',
        );
    });

    it('fails an instance CDK stopped emitting a version for, rather than passing vacuously', () => {
        expect(engineFaults({ ...correct, EngineVersion: undefined }, EXPECTED_ENGINE_VERSION).join(' ')).toContain(
            'EngineVersion is absent',
        );
    });

    it('fails a major upgrade left unpermitted — the failure that would land inside the window', () => {
        expect(
            engineFaults({ ...correct, AllowMajorVersionUpgrade: undefined }, EXPECTED_ENGINE_VERSION).join(' '),
        ).toContain('AllowMajorVersionUpgrade is absent');
    });

    it('fails a frozen minor version', () => {
        expect(
            engineFaults({ ...correct, AutoMinorVersionUpgrade: false }, EXPECTED_ENGINE_VERSION).join(' '),
        ).toContain('AutoMinorVersionUpgrade is false');
    });

    it('fails a custom parameter group, whose family cannot straddle a major version', () => {
        expect(
            engineFaults({ ...correct, DBParameterGroupName: { Ref: 'Pg16Group' } }, EXPECTED_ENGINE_VERSION).join(' '),
        ).toContain('DBParameterGroupName is {"Ref":"Pg16Group"}');
    });

    it('fails a non-postgres engine and reports every fault at once, not just the first', () => {
        expect(engineFaults({ Engine: 'mysql' }, EXPECTED_ENGINE_VERSION)).toHaveLength(4);
    });
});
