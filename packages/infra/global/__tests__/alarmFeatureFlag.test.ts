// @vitest-environment node
/**
 * ⛔ EVERY CloudWatch alarm in this repository is created behind ONE synth-time flag, default OFF.
 *
 * ## The cost this exists to stop
 *
 * Thirty `cloudwatch.Alarm` constructs are spread across five stacks, and not one of them was gated on the
 * stage. A `pr-{N}` preview therefore provisioned ~10 production-grade alarms watching pipelines nobody
 * drives, publishing to SNS topics with no subscribers (`subscribeAlarmEmail` adds none when no address is
 * configured, which is every non-prod stage). Against CloudWatch's 10-alarm free tier the account was
 * carrying 39 — prod 21, sandbox 12, `pr-91` 10 — and every concurrently-open pull request added ten more.
 *
 * ## ⛔ WHY THE FLAG IS NOT READ FROM SSM INSIDE THE CDK CODE
 *
 * `ssm.StringParameter.valueForStringParameter` resolves at **DEPLOY** time: it emits a CloudFormation
 * `Parameter` and returns a `${Token[…]}` string. Whether a construct is INSTANTIATED is decided at **SYNTH**
 * time, in TypeScript — so `if (valueForStringParameter(…) === 'true')` compares a token to a literal, is
 * false forever, and `if (valueForStringParameter(…))` is a non-empty string and therefore true forever.
 * Either way the flag does nothing and nothing fails. That is the failure mode this gate is pointed at, which
 * is why it asserts the ABSENCE of both SSM readers from every alarm-owning stack rather than trusting a
 * reviewer to notice.
 *
 * `valueFromLookup` is the other synth-time option and was rejected for two independent reasons: it performs
 * an AWS call during synth, which every one of this repository's `Template.fromStack` suites runs without
 * credentials; and it caches into `cdk.context.json`, which line 93 of `.gitignore` excludes — so the cache is
 * per-machine, invisible in review, and freezes the flag at whatever the first synth saw.
 *
 * What is left is the honest one: the deploy pipeline reads SSM (`aws ssm get-parameter`) and hands the
 * answer to `cdk synth` in the environment, exactly as `COST_ALERT_EMAIL`, `IDENTITY_IMAGE_TAG` and
 * `FOOD_DESIRED_COUNT` already arrive. SSM remains the per-stage store; the app is simply not the reader.
 *
 * ## Why a source-level gate and not a shared function
 *
 * The rule spans six CDK apps that CANNOT import from one another. Each installs its own `aws-cdk-lib` and
 * pins `rootDir` to its own `infra/` directory, and the one shared channel — `@radicle-co/infra-shared` — is
 * published to GitHub Packages and pinned by exact version in seven manifests, so a new export there is
 * unusable until a release lands and every pin is bumped. This repository already answers that shape with a
 * guard over the sources (`natEgressConsumers`, `prScope`, `alarmSubscriptionWiring`): the knowledge is
 * repeated in code because the boundary forces it, and a test is what keeps the copies identical.
 *
 * ⚠️ Every gate below reads the AST, never the text. A comment explaining the flag contains every word a
 * text search would look for, and this file's own siblings record two gates that passed against deliberately
 * broken code for exactly that reason.
 *
 * DESIGN PATTERN: Specification module — pure predicates over parsed sources, fired at the real tree AND at
 * in-memory violating fixtures so a gate that stops matching fails here instead of passing vacuously.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { cdkApps } from './cdkApps.js';
import { type SourceFile, parse, repoRoot, visit } from './serviceSources.js';

/**
 * The environment variable each CDK app reads the flag from.
 *
 * Unprefixed because it is cross-service, like `STAGE` and `DOMAIN_NAME`; a per-service spelling would let
 * one stage's deploy enable alarms in one stack and not its sibling.
 */
const FLAG_ENV_VAR = 'ALARMS_ENABLED';

/**
 * The ONLY value that enables alarms.
 *
 * Exact, case-sensitive, and compared with `===` so the default is off for absent, empty, malformed and
 * every other spelling. ⚠️ `ALARMS_ENABLED=1` therefore produces NO alarms, silently — the fail-closed
 * direction was chosen deliberately (an observability flag must never fail a service deploy), and the price
 * is that a typo in the parameter reads exactly like "off".
 */
const FLAG_ENABLING_VALUE = 'true';

/** The SSM parameter the deploy pipeline reads to populate {@link FLAG_ENV_VAR}, per stage. */
const FLAG_PARAMETER = '/kitchensink/{stage}/observability/alarms-enabled';

/** The property every alarm-owning stack takes, and the expression its alarms are gated on. */
const FLAG_PROP = 'alarmsEnabled';

/** Both SSM readers that CANNOT decide whether a construct exists. */
const FORBIDDEN_SSM_READERS = ['valueForStringParameter', 'valueFromLookup'] as const;

// ───────────────────────────────── discovery ─────────────────────────────────

/** Read every `.ts` file directly under a stack-library directory. */
function librarySources(directory: string): readonly SourceFile[] {
    const walk = (absolute: string): readonly SourceFile[] => {
        let entries;

        try {
            entries = readdirSync(absolute, { withFileTypes: true });
        } catch {
            return [];
        }

        return entries.flatMap((entry) => {
            const child = path.join(absolute, entry.name);

            if (entry.isDirectory()) {
                return walk(child);
            }

            return entry.name.endsWith('.ts')
                ? [{ file: child.slice(repoRoot.length + 1), contents: readFileSync(child, 'utf8') }]
                : [];
        });
    };

    return walk(path.join(repoRoot, directory));
}

/**
 * Every CDK app in the repository, paired with the sources of the stacks it can construct.
 *
 * An app is `<root>/bin/app.ts`; its stacks are every `.ts` under `<root>/lib`. Discovered rather than
 * listed, so a service that grows its first alarm tomorrow inherits the rule the day it is committed.
 *
 * @returns One entry per CDK app. Impure.
 * @sideEffect Shells out to git (via {@link cdkApps}) and reads the working tree.
 */
function cdkAppsWithStacks(): readonly { readonly app: SourceFile; readonly stacks: readonly SourceFile[] }[] {
    return cdkApps().map((entrypoint) => {
        const app = { file: entrypoint, contents: readFileSync(path.join(repoRoot, entrypoint), 'utf8') };

        return { app, stacks: reachableStacks(entrypoint, app.contents) };
    });
}

/**
 * The stack sources an app can actually construct — its relative imports, followed transitively.
 *
 * ⛔ NOT "every file under the package's `lib/`", which is what this used to be. That approximation held
 * only while a package contained exactly ONE app; the moment `packages/infra/global` gained a second
 * (`bin/account.ts`, the account-scoped app), the directory heuristic attributed every alarm in the global
 * library to it — so an app whose single stack constructs ZERO alarms was required to resolve the alarm
 * flag. The finding was about a directory, not about the app.
 *
 * Transitive, because the app imports `GlobalStack` and `GlobalStack` imports the children that own the
 * alarms; direct imports alone would attribute nothing and the guard would go quietly vacuous — the more
 * dangerous direction of the same error.
 */
function reachableStacks(entrypoint: string, contents: string): readonly SourceFile[] {
    const packageRoot = path.dirname(path.dirname(entrypoint));
    const library = librarySources(path.join(packageRoot, 'lib'));
    const byPath = new Map(library.map((source) => [path.normalize(source.file), source]));
    const seen = new Set<string>();

    const follow = (fromFile: string, text: string): void => {
        for (const match of text.matchAll(/from\s+'(\.[^']*)'/gu)) {
            const specifier = (match[1] ?? '').replace(/\.js$/u, '.ts');
            const resolved = path.normalize(path.join(path.dirname(fromFile), specifier));
            const source = byPath.get(resolved);

            if (source !== undefined && !seen.has(resolved)) {
                seen.add(resolved);
                follow(resolved, source.contents);
            }
        }
    };

    follow(entrypoint, contents);

    return [...seen].flatMap((file) => byPath.get(file) ?? []);
}

// ─────────────────────────────── pure predicates ───────────────────────────────

/** One `new …Alarm(…)` construction, and whether it sits inside the flag's `if`. */
interface DiscoveredAlarm {
    /** The file that constructs it. */
    readonly file: string;
    /** The construct id, for the finding message. */
    readonly id: string;
    /** True when an enclosing `if (…alarmsEnabled)` guards its construction. */
    readonly gated: boolean;
}

/**
 * Is this expression the flag gate — `props.alarmsEnabled` or a destructured `alarmsEnabled`?
 *
 * ⚠️ Deliberately narrow. `!alarmsEnabled`, `alarmsEnabled || stage === 'prod'` and
 * `alarmsEnabled ?? true` are all NOT the gate: each is a way to re-open the default this exists to close,
 * and a predicate that accepted "mentions the identifier" would pass every one of them.
 *
 * @param condition - The `if` statement's condition.
 * @returns True when the condition is exactly the flag. Pure.
 */
function isFlagGate(condition: ts.Expression): boolean {
    if (ts.isIdentifier(condition)) {
        return condition.text === FLAG_PROP;
    }

    return (
        ts.isPropertyAccessExpression(condition) && ts.isIdentifier(condition.name) && condition.name.text === FLAG_PROP
    );
}

/**
 * Every alarm a source constructs, marked with whether the flag guards it.
 *
 * The walk carries the gate down rather than reading `node.parent`: {@link parse} builds the tree with
 * `setParentNodes: false`, so an upward walk would see `undefined` and report every alarm as ungated.
 *
 * @param source - The stack source to read.
 * @returns One entry per alarm construction, in source order. Pure.
 */
function discoverAlarms(source: SourceFile): readonly DiscoveredAlarm[] {
    const alarms: DiscoveredAlarm[] = [];

    const walk = (node: ts.Node, gated: boolean): void => {
        if (ts.isIfStatement(node) && isFlagGate(node.expression)) {
            walk(node.thenStatement, true);

            if (node.elseStatement !== undefined) {
                walk(node.elseStatement, gated);
            }

            return;
        }

        if (ts.isNewExpression(node)) {
            const callee = node.expression;
            const name = ts.isPropertyAccessExpression(callee)
                ? callee.name.text
                : ts.isIdentifier(callee)
                  ? callee.text
                  : '';

            if (/Alarm$/u.test(name)) {
                const idArgument = node.arguments?.[1];

                alarms.push({
                    file: source.file,
                    id: idArgument !== undefined && ts.isStringLiteral(idArgument) ? idArgument.text : '(unnamed)',
                    gated,
                });
            }
        }

        ts.forEachChild(node, (child) => {
            walk(child, gated);
        });
    };

    walk(parse(source), false);

    return alarms;
}

/**
 * Does this source declare the flag as a REQUIRED boolean prop?
 *
 * Required, never optional: an optional prop keeps every existing call site compiling, which is precisely how
 * a stack silently keeps the old behaviour. `readonly alarmsEnabled?: boolean` must fail here.
 *
 * @param source - The stack source to read.
 * @returns True when a props interface declares `readonly alarmsEnabled: boolean`. Pure.
 */
function declaresRequiredFlagProp(source: SourceFile): boolean {
    let declared = false;

    visit(parse(source), (node) => {
        if (!ts.isPropertySignature(node) || !ts.isIdentifier(node.name) || node.name.text !== FLAG_PROP) {
            return;
        }

        if (node.questionToken !== undefined) {
            return;
        }

        declared = node.type?.kind === ts.SyntaxKind.BooleanKeyword;
    });

    return declared;
}

/**
 * Does this app resolve the flag as `process.env['ALARMS_ENABLED'] === 'true'`?
 *
 * Read from the AST so the long comment above the expression — which necessarily names the variable, the
 * value and the SSM path — cannot satisfy the gate on its own.
 *
 * @param source - The CDK app entrypoint.
 * @returns True when the exact comparison is present. Pure.
 */
function resolvesFlagFromEnvironment(source: SourceFile): boolean {
    let resolved = false;

    visit(parse(source), (node) => {
        if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
            return;
        }

        const { left, right } = node;
        const readsFlagVariable =
            ts.isElementAccessExpression(left) &&
            ts.isPropertyAccessExpression(left.expression) &&
            left.expression.name.text === 'env' &&
            ts.isStringLiteral(left.argumentExpression) &&
            left.argumentExpression.text === FLAG_ENV_VAR;

        if (readsFlagVariable && ts.isStringLiteral(right) && right.text === FLAG_ENABLING_VALUE) {
            resolved = true;
        }
    });

    return resolved;
}

/**
 * Which forbidden SSM readers a source uses to DECIDE something.
 *
 * ⚠️ Scoped to conditions on purpose, and this scoping was measured rather than assumed: all four service
 * stacks already call `valueForStringParameter` legitimately — for a database name, a queue URL, a table
 * name — and a gate that banned the reader outright would have failed against a correct tree and been
 * relaxed into meaninglessness. Reading a deploy-time VALUE is exactly what the API is for. Reading a
 * deploy-time value to choose whether a construct EXISTS is the defect, and a condition is where that
 * choice is written: an `if`, a ternary, or a `&&`/`||` chain feeding either.
 *
 * @param source - The source to read.
 * @returns `<reader> in a condition` for each distinct offence. Pure.
 */
function ssmDecidedConditions(source: SourceFile): readonly string[] {
    const found = new Set<string>();

    const readersIn = (node: ts.Node): void => {
        visit(node, (child) => {
            if (!ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) {
                return;
            }

            const name = child.expression.name.text;

            if ((FORBIDDEN_SSM_READERS as readonly string[]).includes(name)) {
                found.add(name);
            }
        });
    };

    visit(parse(source), (node) => {
        if (ts.isIfStatement(node)) {
            readersIn(node.expression);
        }

        if (ts.isConditionalExpression(node)) {
            readersIn(node.condition);
        }

        // `const alarmsEnabled = ssm.…valueForStringParameter(…) === 'true'` never reaches an `if` as a
        // call — it reaches it as a boolean binding. The comparison is the decision.
        if (
            ts.isBinaryExpression(node) &&
            (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
                node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
        ) {
            readersIn(node);
        }
    });

    return [...found].map((reader) => `${source.file}: ${reader} decides a condition`).toSorted();
}

// ───────────────────────────── the discovered tree ─────────────────────────────

const APPS = cdkAppsWithStacks();

/** Every stack source that constructs at least one alarm. */
const ALARM_SOURCES = APPS.flatMap(({ stacks }) => stacks).filter((source) => discoverAlarms(source).length > 0);

/** Every app whose own stack library constructs an alarm, and which must therefore resolve the flag. */
const ALARM_APPS = APPS.filter(({ stacks }) => stacks.some((source) => discoverAlarms(source).length > 0));

// ─────────────────────────────── violating fixtures ───────────────────────────────

/** A stack that creates an alarm outside the gate, with the flag declared OPTIONAL. */
const UNGATED_STACK: SourceFile = {
    file: '(fixture)/UngatedStack.ts',
    contents: `
        export interface UngatedStackProps {
            readonly ${FLAG_PROP}?: boolean;
        }
        export class UngatedStack {
            public constructor(props: UngatedStackProps) {
                // ${FLAG_PROP} — prose naming the flag must not satisfy any gate here.
                const ungated = new cloudwatch.Alarm(this, 'FixtureUngatedAlarm', { threshold: 1 });
                ungated.addAlarmAction(action);
                if (props.${FLAG_PROP}) {
                    const gated = new cloudwatch.Alarm(this, 'FixtureGatedAlarm', { threshold: 1 });
                    gated.addAlarmAction(action);
                }
            }
        }
    `,
};

/** A stack that gates on the flag OR something else — the default this whole change exists to close. */
const REOPENED_GATE_STACK: SourceFile = {
    file: '(fixture)/ReopenedStack.ts',
    contents: `
        export class ReopenedStack {
            public constructor(props: { readonly ${FLAG_PROP}: boolean }) {
                if (props.${FLAG_PROP} || props.stage === 'prod') {
                    const a = new cloudwatch.Alarm(this, 'FixtureReopenedAlarm', { threshold: 1 });
                    a.addAlarmAction(action);
                }
            }
        }
    `,
};

/** An app that reads the flag through the deploy-time SSM token — the trap. */
const DEPLOY_TIME_APP: SourceFile = {
    file: '(fixture)/bin/app.ts',
    contents: `
        const ${FLAG_PROP} =
            ssm.StringParameter.valueForStringParameter(app, '${FLAG_PARAMETER}') === '${FLAG_ENABLING_VALUE}';
    `,
};

// ─────────────────────────────────── the gates ───────────────────────────────────

describe('the alarm feature flag — discovery is not vacuous', () => {
    it('finds every CDK app and the stacks it can construct', () => {
        expect(APPS.length).toBeGreaterThanOrEqual(6);
        expect(APPS.every(({ stacks }) => stacks.length > 0)).toBe(true);
    });

    it('finds the five alarm-owning stacks and all thirty alarms', () => {
        // Pinned as a FLOOR, not an equality: a new alarm must inherit the rule, never trip this count. The
        // floor is what makes every gate below non-vacuous — a discovery that silently found nothing would
        // otherwise report a perfectly gated tree.
        expect(ALARM_SOURCES.map((source) => source.file).toSorted()).toStrictEqual([
            'packages/infra/global/lib/platform/MessageSubstrateStack.ts',
            'packages/services/food-service/infra/lib/FoodServiceStack.ts',
            'packages/services/identity-webhooks/infra/lib/WebhooksStack.ts',
            'packages/services/identity/infra/lib/IdentityServiceStack.ts',
            'packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts',
        ]);
        // EXACTLY thirty, not a floor: a floor cannot tell "an alarm was added" from "the walk counted the
        // gated branch twice", and the double-count is a real defect this assertion caught in its own
        // first draft. A new alarm changes this number ON PURPOSE, in the same commit that adds it.
        expect(ALARM_SOURCES.flatMap(discoverAlarms).length).toBe(30);
        expect(ALARM_SOURCES.flatMap(discoverAlarms).map((alarm) => alarm.id)).toHaveLength(
            new Set(ALARM_SOURCES.flatMap(discoverAlarms).map((alarm) => `${alarm.file}#${alarm.id}`)).size,
        );
    });
});

describe('⛔ every alarm is constructed behind the flag', () => {
    it('reports no ungated alarm anywhere in the tree', () => {
        const ungated = ALARM_SOURCES.flatMap(discoverAlarms)
            .filter((alarm) => !alarm.gated)
            .map((alarm) => `${alarm.file}: '${alarm.id}' is created unconditionally`);

        expect(ungated).toStrictEqual([]);
    });

    it('is not a gate that passes anything: an ungated fixture alarm is reported', () => {
        expect(
            discoverAlarms(UNGATED_STACK)
                .filter((alarm) => !alarm.gated)
                .map((alarm) => alarm.id),
        ).toStrictEqual(['FixtureUngatedAlarm']);
    });

    it('⛔ refuses a widened condition that re-opens the default', () => {
        // `alarmsEnabled || stage === 'prod'` reads like a convenience and is a second, undeclared switch.
        expect(discoverAlarms(REOPENED_GATE_STACK).every((alarm) => alarm.gated)).toBe(false);
    });
});

describe('⛔ every alarm-owning stack takes the flag as a REQUIRED boolean prop', () => {
    it('declares it on every alarm-owning stack', () => {
        const missing = ALARM_SOURCES.filter((source) => !declaresRequiredFlagProp(source)).map(
            (source) => source.file,
        );

        expect(missing).toStrictEqual([]);
    });

    it('rejects the optional spelling, which would let a call site keep the old behaviour silently', () => {
        expect(declaresRequiredFlagProp(UNGATED_STACK)).toBe(false);
    });
});

describe('⛔ the flag is resolved at SYNTH time, from the environment', () => {
    it('every app that owns alarms reads process.env[ALARMS_ENABLED] === "true"', () => {
        const missing = ALARM_APPS.filter(({ app }) => !resolvesFlagFromEnvironment(app)).map(({ app }) => app.file);

        expect(missing).toStrictEqual([]);
    });

    it('⛔ no alarm-owning app or stack reads the flag through a DEPLOY-time SSM token', () => {
        // `valueForStringParameter` returns `${Token[…]}` — a truthy string that never equals 'true', so the
        // comparison is false forever and the bare token is true forever. Either way the flag does nothing
        // and NOTHING FAILS. `valueFromLookup` calls AWS during synth and caches into an ignored
        // `cdk.context.json`, freezing the flag per machine.
        const offenders = [...ALARM_APPS.map(({ app }) => app), ...ALARM_SOURCES]
            .flatMap(ssmDecidedConditions)
            .toSorted();

        expect(offenders).toStrictEqual([]);
    });

    it('is not vacuous: the trap fixture is reported', () => {
        expect(ssmDecidedConditions(DEPLOY_TIME_APP)).toStrictEqual([
            '(fixture)/bin/app.ts: valueForStringParameter decides a condition',
        ]);
        expect(resolvesFlagFromEnvironment(DEPLOY_TIME_APP)).toBe(false);
    });
});

describe('the SSM parameter that backs the flag', () => {
    it('follows the repository path convention, per stage', () => {
        // `/kitchensink/{stage}/{domain}/{name}`, as `messageTableNameParameter` and
        // `recipeDatabaseNameParameter` already spell it. Per-stage is the requirement: prod may enable
        // while sandbox and every `pr-{N}` stay off.
        expect(FLAG_PARAMETER).toMatch(/^\/kitchensink\/\{stage\}\/[a-z-]+\/[a-z-]+$/u);
    });

    it('is documented in the apps that consume it, so the pipeline step has one authority to copy', () => {
        const undocumented = ALARM_APPS.filter(({ app }) => !app.contents.includes('observability/alarms-enabled')).map(
            ({ app }) => app.file,
        );

        expect(undocumented).toStrictEqual([]);
    });
});
