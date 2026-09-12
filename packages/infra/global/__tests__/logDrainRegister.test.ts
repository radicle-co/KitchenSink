// @vitest-environment node
/**
 * Repo-wide guard: **every declared log group is in ADR-0042's register, every register entry that claims a
 * filter has one in the stack the table names, and the runtime register agrees with all of it.**
 *
 * ## Why it is a DOCUMENT rather than an assertion over one template
 *
 * The filters live in SIX different CDK apps — the global app plus identity, food, recipe, recipe-workers and
 * ingredient-parser — and no synthesized template can see across apps. So the authority is a table in the
 * ADR, and this guard holds five independent things to it:
 *
 *  1. every `new logs.LogGroup(...)` DECLARED anywhere in the repo appears in the table;
 *  2. every table row claiming a filter has a `logs.SubscriptionFilter` in the stack the table names;
 *  3. the RUNTIME register (`logDrainRegister.ts`) covers exactly the table's rows;
 *  4. NO stack imports the forwarder's ARN as a CloudFormation export — that import is a deploy deadlock;
 *  5. every stack that attaches a filter takes the ARN as a prop, guards on it, and every file that deploys
 *     such an app resolves it — an unwired deploy is GREEN with its drains unattached.
 *
 * ## Why all of them, and not just the runtime register
 *
 * Because the failure this exists to catch is an ADDITION nobody noticed. A new service declares a log group,
 * ships, and its logs go nowhere — silently, because an absence of logs is what a healthy quiet system looks
 * like. The runtime register alone would not notice, since nothing would ever hand it that group's name.
 */
import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { LOG_DRAIN_SOURCES } from '../../../services/identity-webhooks/src/common/logDrainRegister.js';
import { GlobalStack } from '../lib/platform/GlobalStack.js';
import { testApp } from './testApp.js';
import { productionSources, readSource, withoutTsComments, REPO_ROOT } from './roleSplitSources.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Delimits the machine-checked table inside the ADR. Prose outside them is free to say anything. */
const TABLE_START = '<!-- log-drain:start -->';
const TABLE_END = '<!-- log-drain:end -->';

const ADR = 'docs/architecture/decisions/0042-log-drain-coverage.md';

/** One row of ADR-0042's register. */
interface RegisterRow {
    readonly group: string;
    readonly ownerStack: string;
    readonly hasFilter: boolean;
    readonly key: string;
}

/**
 * The register, read from the ADR itself.
 *
 * @returns One entry per table row.
 */
function registerRows(): readonly RegisterRow[] {
    const adr = readFileSync(join(REPO_ROOT, ADR), 'utf8');
    const table = adr.slice(adr.indexOf(TABLE_START) + TABLE_START.length, adr.indexOf(TABLE_END));

    return table
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('|') && !line.startsWith('| ---') && !line.includes('Log group'))
        .map((line) => {
            const cells = line
                .split('|')
                .slice(1, -1)
                .map((cell) => cell.trim().replace(/`/gu, ''));

            return {
                group: cells[0] ?? '',
                ownerStack: cells[1] ?? '',
                hasFilter: cells[2] === 'yes',
                key: cells[3] ?? '',
            };
        });
}

/** Infra sources that declare a CDK log group or subscription filter. */
function infraSources(): readonly string[] {
    return productionSources().filter((path) => /infra\/lib\/.*\.ts$/u.test(path) || path.includes('/lib/platform/'));
}

/** The construct ids of every `new logs.LogGroup(...)` in one source. */
function declaredGroups(source: string): readonly string[] {
    const text = withoutTsComments(readSource(source));

    return [...text.matchAll(/new logs\.LogGroup\(\s*this,\s*'([^']+)'/gu)].map((match) => match[1] ?? '');
}

/**
 * How many `new logs.SubscriptionFilter(...)` a source declares.
 *
 * ⚠️ COUNTED, not named. `WebhooksStack` creates its three in a LOOP over a target list, so the construct id
 * is a variable and no literal exists to read — a guard that matched only `this, 'SomeId'` would report that
 * stack as having no filters at all, which is the opposite of the truth and the reason this counts instead.
 *
 * @param source - One infra source file.
 * @returns The number of filters declared. Pure.
 */
function filterCount(source: string): number {
    return [...withoutTsComments(readSource(source)).matchAll(/new logs\.SubscriptionFilter\(/gu)].length;
}

describe('the log-drain register (ADR-0042)', () => {
    it('⛔ the RUNTIME register covers exactly the ADR table, in both directions', () => {
        expect(LOG_DRAIN_SOURCES.map((source) => source.service).sort()).toEqual(
            registerRows()
                .map((row) => row.key)
                .sort(),
        );
    });

    /**
     * ⛔ THE ADDITION NOBODY NOTICED, which is what this whole file is for. A new service declares a log
     * group, ships, and its logs go nowhere — silently, because an absence of logs is what a healthy quiet
     * system looks like. This is the only assertion that can see that happen.
     */
    it('⛔ every DECLARED log group in the repository appears in the register', () => {
        const unregistered: string[] = [];
        const rows = registerRows();

        for (const source of infraSources()) {
            for (const construct of declaredGroups(source)) {
                // The table names groups by their runtime NAME, which carries the construct id for a
                // CDK-generated one and not at all for an explicitly named one — so match on either.
                const known = rows.some(
                    (row) => row.group.includes(construct) || row.key === constructToKey(construct),
                );

                if (!known) {
                    unregistered.push(`${source}: ${construct}`);
                }
            }
        }

        expect(unregistered, unregistered.join('\n')).toEqual([]);
    });

    it('⛔ every register row that claims a filter has one declared in the stack the table names', () => {
        const missing: string[] = [];

        for (const row of registerRows().filter((candidate) => candidate.hasFilter)) {
            const owner = infraSources().find((source) => source.endsWith(`${row.ownerStack}.ts`));

            if (owner === undefined) {
                missing.push(`${row.key}: no source named ${row.ownerStack}`);
                continue;
            }

            if (filterCount(owner) === 0) {
                missing.push(`${row.key}: ${row.ownerStack} declares no SubscriptionFilter`);
            }
        }

        expect(missing, missing.join('\n')).toEqual([]);
    });

    /**
     * ⛔ NOBODY MAY IMPORT THE FORWARDER'S ARN, and this is the assertion that says so, because the import
     * is the DEADLOCK rather than a symptom of it.
     *
     * `WebhooksStack` — which publishes the export — imports `kitchensink-data-{stage}:HandleSyncTopicArn`
     * from the global app, and ADR-0035 deploys each SCHEMA stack ahead of everything that reads its
     * database, the webhooks stack included. So a stack that `Fn.importValue`s `LogForwarderArn` waits for
     * a stack the same pipeline necessarily deploys later. `kitchensink-identity-schema-sandbox` died in
     * `UPDATE_ROLLBACK_IN_PROGRESS` with _"No export named kitchensink-identity-webhooks-sandbox:
     * LogForwarderArn found"_, taking three more deploy jobs with it, and no ordering of the existing steps
     * resolves it.
     *
     * ⚠️ It enumerates NOTHING — it reads every infra source and fails on the text. The earlier fix moved
     * three stacks to a CI-resolved input and left seven importing, which is what a list of names does: the
     * list was right about the stacks it named and silent about the rest.
     */
    it('⛔ no stack imports the forwarder ARN as a CloudFormation export — that is the deadlock', () => {
        const importers = infraSources().filter((source) =>
            /Fn\.importValue\([^)]*LogForwarderArn/u.test(withoutTsComments(readSource(source))),
        );

        expect(importers, importers.join('\n')).toEqual([]);

        // ⛔ INCLUDING THE PRODUCER'S OWN DESCRIPTION, which ships into CloudFormation and is what an
        // operator reads in the console beside the export. It said "imported by every stack that owns a
        // drained group" — true when written, and afterwards an instruction to recreate the deadlock.
        const producer = infraSources().find((source) =>
            readSource(source).includes("new CfnOutput(this, 'LogForwarderArn'"),
        );

        expect(producer, 'no source publishes the LogForwarderArn export — has it moved?').toBeDefined();

        const description = /new CfnOutput\(this, 'LogForwarderArn', \{[^}]*description:\s*\n?\s*'([^']*)'/u.exec(
            readSource(producer ?? ''),
        )?.[1];

        expect(description, `${producer ?? ''}: the export no longer carries a readable description`).toBeDefined();

        // ⚠️ Both directions, because "never imported" contains the word. What is forbidden is the
        // AFFIRMATIVE claim; what is required is the mechanism that replaced it, which the old string
        // cannot satisfy.
        expect(
            description,
            `${producer ?? ''}: the export describes itself as imported, which is the deadlock`,
        ).not.toMatch(/\bimported by\b/iu);
        expect(
            description,
            `${producer ?? ''}: the export does not say how it actually reaches its consumers`,
        ).toContain('LOG_FORWARDER_ARN');
    });

    /**
     * ⛔ EVERY FILTER IS CONDITIONAL, AND THE SOURCE-TEXT COUNT ABOVE CANNOT SEE A CONDITIONAL. Wrapping a
     * filter in `if (props.logForwarderArn !== undefined)` leaves the `new logs.SubscriptionFilter(` text
     * exactly where it was, so `filterCount` answers the same number and the row still reads `yes` — a
     * guard that matches whatever happens reports success in the one direction that costs logs.
     *
     * So the SHAPE is asserted here and the BEHAVIOUR is asserted twice: against the synthesized template
     * for the stacks this app owns (below), and in each owning package's own infra suite for the rest,
     * which is where those stacks can be synthesized at all — their `aws-cdk-lib` resolves only from their
     * own `infra/` install.
     *
     * ⚠️ The exception is DERIVED, not named: `WebhooksStack` declares the forwarder rather than importing
     * it, so it holds the function object and needs no prop. It is identified by the export it publishes.
     */
    it('⛔ every stack that attaches a filter takes the ARN as a prop and guards on it', () => {
        const defects: string[] = [];

        for (const source of infraSources()) {
            const text = withoutTsComments(readSource(source));

            if (filterCount(source) === 0 || text.includes("new CfnOutput(this, 'LogForwarderArn'")) {
                continue;
            }

            if (!/readonly logForwarderArn\?: string;/u.test(text)) {
                defects.push(`${source}: declares a filter but takes no optional logForwarderArn prop`);
            }

            if (!/props\.logForwarderArn === undefined|props\.logForwarderArn !== undefined/u.test(text)) {
                defects.push(`${source}: declares a filter that is not guarded on props.logForwarderArn`);
            }
        }

        expect(defects, defects.join('\n')).toEqual([]);
    });

    /**
     * ⛔ EVERY DEPLOY OF SUCH AN APP MUST RESOLVE THE ARN, or it deploys GREEN with its drains unattached —
     * an absence whose only symptom is missing logs, which is what a healthy quiet system also looks like.
     * Making the prop optional bought the deadlock's cure with exactly this hazard, so the wiring is
     * asserted rather than remembered.
     *
     * ⚠️ DERIVED FROM THE DEPLOY COMMAND, not from a list of workflows. Each `cdk deploy --app` names the
     * app's path; the package that path sits in either reads `props.logForwarderArn` in its `lib/` or it
     * does not. A tenth deploy step, or a new workflow, is covered by existing rather than by being added
     * here — which is the failure mode the earlier per-step `env:` wiring had.
     */
    it('⛔ every file that deploys a conditional-drain app also resolves the forwarder ARN', () => {
        const deployFiles = [
            ...readdirSync(join(REPO_ROOT, '.github/workflows'))
                .filter((name) => name.endsWith('.yml'))
                .map((name) => `.github/workflows/${name}`),
            '.github/actions/infra-package/action.yml',
        ];

        // ⚠️ The RESOLUTION is matched, not the words: every mention of `LogForwarderArn` in these files is
        // otherwise a COMMENT explaining the cycle, so a `toContain` on the name passes over a step whose
        // lookup has been changed to another export. This is the command, and only the command.
        const resolvesTheArn = (text: string): boolean =>
            /cfnExport\.sh --optional "kitchensink-identity-webhooks-\$\{\w+\}:LogForwarderArn"/u.test(text);

        // ⚠️ The ENTRY is taken whole, so `accountDeploy.yml` — which deploys the global package's OTHER
        // entry, the account-scoped cost guardrails — is correctly not asked to resolve an ARN.
        const deployedBy = (text: string): readonly string[] =>
            [...text.matchAll(/cdk deploy[^\n]*?--app "[^"]*?(packages\/[\w/-]+\/bin\/[\w.]+\.ts)"/gu)]
                .map((match) => match[1] ?? '')
                .filter((entry) => conditionalEntries().includes(entry));

        const defects: string[] = [];

        for (const file of deployFiles) {
            const text = readSource(file);
            const deployed = deployedBy(text);

            if (deployed.length > 0 && !resolvesTheArn(text)) {
                defects.push(`${file}: deploys ${[...new Set(deployed)].join(', ')} without resolving the ARN`);
            }
        }

        // The composite action deploys by `inputs.directory`, so no command names a path — assert it directly.
        expect(
            resolvesTheArn(readSource('.github/actions/infra-package/action.yml')),
            'the composite action no longer resolves the forwarder ARN for its 12 callers',
        ).toBe(true);
        expect(defects, defects.join('\n')).toEqual([]);

        // ⛔ AND THE INVERSE, because the forward check above can only see an app whose entry sits at
        // `…/infra/bin/` — and `packages/infra/global/bin/app.ts`, which owns THREE of the conditional
        // drains, does not. It passed only because both workflows happen to deploy a service app as well.
        // Asking "is every conditional package deployed by a file this test examined?" needs no path shape
        // at all, so the next entry point that lives somewhere else is covered by existing.
        const undeployed = conditionalEntries().filter(
            (entry) => !deployFiles.some((file) => deployedBy(readSource(file)).includes(entry)),
        );

        expect(
            undeployed,
            `${undeployed.join(', ')}: constructs a conditional drain but no examined file deploys it — ` +
                'either the deploy moved somewhere this test does not read, or the extraction stopped ' +
                'matching it, which is how the global app went unchecked before',
        ).toEqual([]);
    });

    /**
     * ⚠️ What the template assertions below still do NOT prove is that a DEPLOYED stage has its filters
     * attached — ADR-0042 records that as owed, because the absent case converges only on the next deploy
     * of each app.
     *
     * @returns Every `AWS::Logs::SubscriptionFilter` in the synthesized global app, for one ARN posture.
     */
    const globalAppFilterIds = (stage: string, logForwarderArn?: string): readonly string[] => {
        const global = new GlobalStack(testApp(), `Global-${stage}`, {
            env: { account: '123456789012', region: 'us-east-1' },
            stackName: `kitchensink-global-${stage}`,
            stage,
            alarmsEnabled: true,
            domainName: 'commise.app',
            ...(logForwarderArn === undefined ? {} : { logForwarderArn }),
        });

        return global.node
            .findAll()
            .filter((construct): construct is Stack => Stack.isStack(construct))
            .flatMap((stack) => Object.keys(Template.fromStack(stack).findResources('AWS::Logs::SubscriptionFilter')));
    };

    const globalAppFilters = (logForwarderArn?: string): number =>
        globalAppFilterIds('sandbox', logForwarderArn).length;

    // ⚠️ MEMOIZED, because each of these walks every production source and they are asked repeatedly —
    // once per deploy file, and once per class per entry. Derived-not-enumerated is the point of them; a
    // re-derivation per question turned one assertion into a 30-second timeout.
    const memoize = <T>(derive: () => T): (() => T) => {
        let cached: { readonly value: T } | undefined;

        return () => {
            cached ??= { value: derive() };

            return cached.value;
        };
    };

    /** Infra sources whose stacks guard a filter on `props.logForwarderArn`. */
    const conditionalStacks = memoize((): readonly string[] =>
        infraSources().filter((source) => /props\.logForwarderArn/u.test(withoutTsComments(readSource(source)))),
    );

    /**
     * ⛔ THE UNIT IS THE APP ENTRY, NOT THE PACKAGE, and CONSTRUCTING is not IMPORTING. Two readings were
     * wrong before this one, in opposite directions.
     *
     * By package: `packages/infra/global` owns three conditional drains, but its SECOND entry —
     * `bin/account.ts`, the account-scoped cost guardrails — builds `CostGuardrailsStack` and no drain at
     * all, so grading the package demands that `accountDeploy.yml` resolve an ARN nothing it deploys can
     * use. By import: `bin/printFoodHost.ts` imports `FoodServiceStack` to compute a hostname and deploys
     * nothing, so following imports makes a pure helper owe a deploy wiring it has no deploy for.
     *
     * ⚠️ The class name comes from the file name, which is a convention this file already leans on — the
     * register's `Owner stack` column is matched to `${'${ownerStack}'}.ts` two assertions above. What is NOT
     * assumed is a path shape: requiring `…/infra/bin/` is what made the first deploy-wiring assertion blind
     * to `packages/infra/global/bin/app.ts`, i.e. to the app whose deadlock motivated the conditional form.
     *
     * ⛔ ITS LIMIT, STATED RATHER THAN IMPLIED: it matches the class NAME in a `new` expression, so a
     * construction through an alias (`import { X as Y }` … `new Y(`), a loop over a class list, or a factory
     * is NOT detected — and such an entry is then classified non-conditional, which makes BOTH directions
     * pass vacuously rather than fail. No entry in this repository does any of those (all ten `bin/*.ts`
     * name their stacks directly), and resolving identifiers through their import bindings is a larger
     * change than the gap; ADR-0042 carries it as a residual so it is recorded rather than assumed away.
     *
     * @returns Every `bin/*.ts` that names a guarded stack class directly in a `new` expression.
     */
    const guardedClasses = memoize((): readonly string[] =>
        conditionalStacks().map((source) => source.replace(/^.*\/|\.ts$/gu, '')),
    );

    const conditionalEntries = memoize((): readonly string[] =>
        productionSources().filter((source) => {
            if (!/\/bin\/[\w.]+\.ts$/u.test(source)) {
                return false;
            }

            const text = withoutTsComments(readSource(source));

            return guardedClasses().some((className) => text.includes(`new ${className}(`));
        }),
    );

    /**
     * ⛔ THE APP ENTRY IS THE OTHER HALF OF THE WIRING, and the rule it carries fails SILENTLY.
     *
     * CI resolving the ARN buys nothing unless the app READS it, and reads it correctly: `cfnExport.sh
     * --optional` prints nothing when the export does not exist, and an empty GitHub Actions step output
     * arrives as a variable that is SET and EMPTY rather than unset. An entry checking only `=== undefined`
     * therefore treats "no forwarder yet" as "here is a forwarder named ''" and synthesizes a filter whose
     * destination ARN is the empty string — a clean synth and a failed deploy.
     *
     * ⚠️ DERIVED from the same set as the deploy-wiring assertion, so an app that starts constructing a
     * guarded stack acquires this obligation by doing so, and one that stops loses it. Nothing is
     * enumerated — which is what seven comments claiming this guard existed needed in order to be true,
     * and were not: no test in the repository read an app entry at all.
     *
     * ⛔ COUNTED, NOT MERELY PRESENT, and the difference is the whole assertion. `text.includes(…)` answers
     * "does this file mention the right shape ANYWHERE", which is strictly weaker than "every site has it" —
     * and two of these entries construct TWO guarded stacks each (`food-service` and `recipe-service`), so
     * four of the eight readings sat behind a check that one correct sibling satisfied. Breaking one of a
     * pair passed. ⚠️ The mutations that cleared the first version tested SINGLE-reading entries, where
     * file-level and site-level coincide: a mutation on the covered instance proves the rule fires and says
     * nothing about its granularity. So the expected count is DERIVED from the same file — one guarded
     * reading per guarded construction — and a copy-pasted third stack is covered by arithmetic.
     */
    it('⛔ every app entry reads LOG_FORWARDER_ARN, and treats an EMPTY value as absent', () => {
        const defects: string[] = [];

        // Both halves in one pattern: a reading that tests only `undefined` does not match, and an entry
        // that tests neither contributes nothing — so the count falls short either way.
        const GUARDED_READING =
            /\.\.\.\(process\.env\['LOG_FORWARDER_ARN'\] === undefined \|\|\s*process\.env\['LOG_FORWARDER_ARN'\] === ''/gu;

        for (const source of conditionalEntries()) {
            const text = withoutTsComments(readSource(source));
            const readings = [...text.matchAll(GUARDED_READING)].length;
            const constructions = guardedClasses().reduce(
                (total, className) => total + [...text.matchAll(new RegExp(`new ${className}\\(`, 'gu'))].length,
                0,
            );

            if (readings !== constructions) {
                defects.push(
                    `${source}: ${constructions} construction(s) of a guarded stack but ${readings} reading(s) ` +
                        'of LOG_FORWARDER_ARN that treat BOTH an unset and an EMPTY value as absent',
                );
            }
        }

        expect(defects, defects.join('\n')).toEqual([]);
        expect(
            conditionalEntries().length,
            'no app entry constructs a guarded stack — has the construction match stopped matching?',
        ).toBeGreaterThan(0);
    });

    /** The register rows whose owner stack is synthesized by THIS app — i.e. the conditional ones. */
    const conditionalRows = (): readonly RegisterRow[] =>
        registerRows().filter(
            (row) =>
                row.hasFilter &&
                infraSources().some(
                    (source) => source.includes('/lib/platform/') && source.endsWith(`${row.ownerStack}.ts`),
                ),
        );

    it('⛔ attaches every conditional filter the register claims when the forwarder ARN is known', () => {
        const rows = conditionalRows();

        expect(rows.length, 'the register lists no filters owned by this app — has a row moved?').toBeGreaterThan(0);
        expect(globalAppFilters('arn:aws:lambda:us-east-1:123456789012:function:log-forwarder')).toBe(rows.length);
    });

    /**
     * ⚠️ The absent case is a SUPPORTED state, not a failure — a fresh account cannot bootstrap either app
     * if this throws. It is asserted so that "no filters" stays a deliberate posture rather than something
     * a later edit can arrive at by accident.
     */
    it('⛔ attaches NONE of them when the ARN is absent, rather than synthesizing a broken filter', () => {
        expect(globalAppFilters(undefined)).toBe(0);
    });

    /**
     * ⛔ The forwarder's own group must stay UNFILTERED. A filter on it feeds the Lambda its own output:
     * every forwarded batch writes a line, which the filter forwards, which writes a line. Asserted, because
     * "add the missing filter" is exactly what a future reader tidying this table would do.
     */
    it("⛔ the log forwarder's own group is registered and deliberately NOT filtered", () => {
        const row = registerRows().find((candidate) => candidate.key === 'log-forwarder');

        expect(row).toBeDefined();
        expect(row?.hasFilter).toBe(false);
    });

    /**
     * ⛔ THE WARNING MAY NOT NAME DRAINS ANY MORE, AND THAT IS A TIGHTENING RATHER THAN A RETREAT.
     *
     * It used to name them, and was held per stage against the global app's synth — which was right while
     * the global app was the only one whose filters were conditional. It is no longer: every drain in the
     * repository is conditional now, spread across six CDK apps, and a run deploys a different subset of
     * them depending on which deploy flags fired. No synthesis available to any one test can enumerate that
     * subset, so a message that names groups is a claim NOBODY can check — and an unchecked operator-facing
     * claim read during an incident is exactly what the prod message was when it named `per-pr-reaper` and
     * `sandbox-scheduler`, two resources prod does not build.
     *
     * So the warning states the true thing without enumerating, and this asserts that it enumerates nothing:
     * a register key appearing in it is a claim the shape of the one that was wrong before.
     */
    it('⛔ each absent-ARN warning states the gap WITHOUT naming drains no synth can enumerate', () => {
        const warned = [
            '.github/workflows/prod-deploy.yml',
            '.github/workflows/sandbox-identity-deploy.yml',
            '.github/actions/infra-package/action.yml',
        ];

        const keys = registerRows()
            .map((row) => row.key)
            .filter((key) => key !== '');

        for (const file of warned) {
            // ⚠️ MATCHED ON THE `echo` LINE, and asserted to be the ONLY occurrence. Reading raw YAML and
            // taking the first match grades whatever comes first — so a future comment restating the
            // message would be graded instead of the message. That is the same prose-matching weakness the
            // deploy-wiring assertion had against `toContain('LogForwarderArn')`, one file over.
            const emitted = [
                ...readSource(file).matchAll(/echo "(::warning::no LogForwarderArn export yet[^"\n]*)"/gu),
            ];

            expect(emitted, `${file} no longer echoes the absent-ARN warning`).toHaveLength(1);

            const warning = emitted[0]?.[1];

            expect(warning).toContain('UNATTACHED');

            const named = keys.filter((key) => (warning ?? '').includes(key));

            expect(named, `${file}: the warning names ${named.join(', ')}, which nothing can verify`).toEqual([]);
        }
    });

    /**
     * ⛔ THE GLOBAL APP'S OWN ROWS ARE STILL HELD PER STAGE, because that one app CAN be synthesized here and
     * the per-stage difference is real: `DataStack` guards the reaper with `stageTag !== 'prod'` and
     * `GlobalStack` guards the scheduler with `stage === 'sandbox'`, so prod declares only `db-bootstrap`.
     * Dropping this with the warning assertion would have lost a fact that is still checkable.
     */
    it('⛔ the global app declares the drains its stage builds, and no others', () => {
        const arn = 'arn:aws:lambda:us-east-1:123456789012:function:log-forwarder';

        const rowsAt = (stage: string): readonly string[] => {
            const ids = globalAppFilterIds(stage, arn);

            return (
                conditionalRows()
                    // The register names the GROUP (`…-DbBootstrapLogGroup*`); the filter's logical id carries
                    // the same construct prefix with `LogDrain`. One token joins the two — no list.
                    .filter((row) => {
                        const prefix = /-(\w+)LogGroup/u.exec(row.group)?.[1] ?? '';

                        return prefix !== '' && ids.some((id) => id.startsWith(`${prefix}LogDrain`));
                    })
                    .map((row) => row.key)
                    .sort()
            );
        };

        expect(rowsAt('sandbox')).toEqual(['db-bootstrap', 'per-pr-reaper', 'sandbox-scheduler']);
        expect(rowsAt('prod')).toEqual(['db-bootstrap']);
    });

    /**
     * ⛔ THE DRAIN STAGE IS STATED IN SEVERAL PLACES AND A DRIFT IS SILENT. `DataStack` derives it
     * (`stage === 'prod' ? 'prod' : 'sandbox'`) to build the Sentry DSN's SSM path, and each deploy surface
     * states it again to resolve the forwarder's ARN. If those disagree, a stage reports to one stage's
     * Sentry project through the OTHER stage's forwarder — both halves work, so nothing fails and nothing
     * says so.
     *
     * ⚠️ The rule is read from `DataStack`'s own source rather than restated here, so the assertion is
     * "the deploy surfaces agree with the code", not "they agree with a third copy".
     *
     * ⚠️ The composite action states it as a CASE rather than a literal, because it serves every stage:
     * `prod` rides prod and everything else — `sandbox` and every `pr-{N}` — rides sandbox. That is the same
     * rule one control-flow shape over, so it is read as one and compared to the same two captures. It is
     * derived ONCE in that file, in `Resolve the platform tier`, because the step that consumes it for the
     * forwarder is unconditional while the step that consumes it for the platform exports is not.
     */
    it('⛔ each deploy surface resolves the forwarder from the stage DataStack derives', () => {
        const rule = /const drainBaseStage = props\.stage === 'prod' \? '(\w+)' : '(\w+)';/u.exec(
            readSource('packages/infra/global/lib/platform/DataStack.ts'),
        );

        expect(rule, 'DataStack no longer derives drainBaseStage in the shape this guard reads').not.toBeNull();

        const drainStageOf = (workflow: string): string | undefined =>
            /^\s*DRAIN_STAGE:\s*(\S+)\s*$/mu.exec(readSource(`.github/workflows/${workflow}`))?.[1];

        expect(drainStageOf('prod-deploy.yml')).toBe(rule?.[1]);
        expect(drainStageOf('sandbox-identity-deploy.yml')).toBe(rule?.[2]);

        const composite = readSource('.github/actions/infra-package/action.yml');
        const tier = /case "\$\{STAGE\}" in\s*\n\s*(\w+)\) base=(\w+) ;;\s*\n\s*\*\) base=(\w+) ;;/u.exec(composite);

        expect(
            tier,
            'the composite action no longer derives the platform tier in the shape this guard reads',
        ).not.toBeNull();
        expect([tier?.[1], tier?.[2]]).toEqual([rule?.[1], rule?.[1]]);
        expect(tier?.[3]).toBe(rule?.[2]);

        // Derived once: exactly one `case` over the stage in that file, so the two consumers cannot diverge.
        expect([...composite.matchAll(/case "\$\{STAGE\}" in/gu)]).toHaveLength(1);
    });

    /**
     * ⚠️ AWS's non-adjustable quota is two subscription filters per log group. Every group in this
     * repository has at most one, so the quota is not near — asserted as "each owner declares no more
     * filters than it declares groups" rather than by counting per group, which no static read can do when
     * one stack creates filters in a loop over imported groups.
     */
    it('no owner stack declares more filters than it has groups to attach them to', () => {
        for (const source of infraSources()) {
            const filters = filterCount(source);

            if (filters === 0) {
                continue;
            }

            // WebhooksStack attaches to an IMPORTED group as well as its own two, so allow one extra.
            expect(filters, source).toBeLessThanOrEqual(declaredGroups(source).length + 1);
        }
    });
});

/**
 * The register key a construct id implies, for the explicitly-named groups whose runtime name carries no id.
 *
 * @param construct - The CDK construct id.
 * @returns The register key, or the id itself when there is no mapping.
 */
function constructToKey(construct: string): string {
    const byConstruct: Readonly<Record<string, string>> = {
        IdentityServiceLogGroup: 'identity-service',
        RecipeWorkersLogGroup: 'recipe-workers',
        IngredientParserLogGroup: 'ingredient-parser',
    };

    return byConstruct[construct] ?? construct;
}
