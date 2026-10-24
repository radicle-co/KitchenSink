// @vitest-environment node
/**
 * Repo-wide guard: EVERY CDK app tags its tree with `kitchensink:tier`, and with the value its stage's execution
 * role matches (ADR-0065).
 *
 * ## The failure this pins
 *
 * The CloudFormation execution role authorizes every modify and delete by the resource's `kitchensink:tier` tag.
 * A resource whose tag is missing or wrong matches no Allow, so the failure is LOUD on the next deploy of that stack
 * (`AccessDenied`, the action named) — but only after the stack is already half applied. This guard moves the same
 * failure to the pull request: an app that stops tagging, tags the wrong key, or derives the value from something
 * other than its stage cannot merge.
 *
 * ## What "the right value" means, and how it is checked
 *
 * A stage app's value must be `tierTagValueForStage(<the stage it builds its App for>)`: the same rule, from the same
 * module, as the qualifier it deploys through, so the tag and the bootstrap role cannot disagree. The expression the
 * app really contains is EVALUATED for each stage (not re-implemented here), and the answers are held to the
 * qualifier the stage deploys through: `prod` is `prod`, everything else is `nonprod`. The account app has no stage
 * and must answer `account` for every stage it is handed.
 *
 * ## Why the AST, and why the apps are DISCOVERED
 *
 * Every entrypoint carries prose about `Tags.of(app)`, so a textual match accepts a comment (`environmentTagCoverage`
 * records the same lesson). The app set comes from {@link cdkApps}, so a new app is covered the day it is committed.
 *
 * @pattern Specification module over a derived set — asserted per app, with negative controls so the predicate can fail
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    accountTierTagValue,
    qualifierForStage,
    tierTagValue,
    tierTagValueForStage,
} from '@kitchensink/cdk-bootstrap/qualifiers';

import { cdkApps } from './cdkApps.js';
import { parse, repoRoot, visit } from './serviceSources.js';

const ACCOUNT_APP = 'packages/infra/global/bin/account.ts';
const QUALIFIERS_MODULE = '@kitchensink/cdk-bootstrap/qualifiers';

/** What the guard learns from one entrypoint. */
interface TierTagReading {
    /** `TIER_TAG_KEY` was imported from the qualifiers module. */
    readonly importsKey: boolean;
    /** The value expression of `Tags.of(<app>).add(TIER_TAG_KEY, <value>)`, when that exact call exists. */
    readonly valueExpression: string | undefined;
    /** The identifier the app passes to `kitchenSinkAppProps(...)`, when it does. */
    readonly stageIdentifier: string | undefined;
}

/**
 * Read the tier tag out of an entrypoint's source.
 *
 * @param file - Path, for the parser only.
 * @param contents - The entrypoint's text.
 * @returns What was found. Pure.
 */
function readTierTag(file: string, contents: string): TierTagReading {
    const source = parse({ file, contents });
    let importsKey = false;
    let appBinding: string | undefined;
    let stageIdentifier: string | undefined;
    const tagged = new Map<string, string>();

    visit(source, (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const bindings = node.importClause?.namedBindings;

            if (
                node.moduleSpecifier.text === QUALIFIERS_MODULE &&
                bindings !== undefined &&
                ts.isNamedImports(bindings) &&
                bindings.elements.some((element) => element.name.text === 'TIER_TAG_KEY')
            ) {
                importsKey = true;
            }
        }

        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            ts.isNewExpression(node.initializer) &&
            ts.isIdentifier(node.initializer.expression) &&
            node.initializer.expression.text === 'App'
        ) {
            appBinding = node.name.text;
            const [props] = node.initializer.arguments ?? [];

            if (
                props !== undefined &&
                ts.isCallExpression(props) &&
                ts.isIdentifier(props.expression) &&
                props.expression.text === 'kitchenSinkAppProps' &&
                props.arguments[0] !== undefined &&
                ts.isIdentifier(props.arguments[0])
            ) {
                stageIdentifier = props.arguments[0].text;
            }
        }

        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
            return;
        }

        const [key, value] = node.arguments;
        const receiver = node.expression.expression;

        if (
            node.expression.name.text === 'add' &&
            key !== undefined &&
            ts.isIdentifier(key) &&
            key.text === 'TIER_TAG_KEY' &&
            value !== undefined &&
            ts.isCallExpression(receiver) &&
            ts.isPropertyAccessExpression(receiver.expression) &&
            receiver.expression.name.text === 'of' &&
            ts.isIdentifier(receiver.expression.expression) &&
            receiver.expression.expression.text === 'Tags' &&
            receiver.arguments[0] !== undefined &&
            ts.isIdentifier(receiver.arguments[0])
        ) {
            tagged.set(receiver.arguments[0].text, value.getText(source));
        }
    });

    return {
        importsKey,
        valueExpression: appBinding === undefined ? undefined : tagged.get(appBinding),
        stageIdentifier,
    };
}

/** The value an entrypoint's own expression produces for a stage (the app's expression, evaluated, not restated). */
function evaluate(expression: string, stage: string): string {
    return String(
        new Function('stage', 'tierTagValueForStage', 'accountTierTagValue', `return (${expression});`)(
            stage,
            tierTagValueForStage,
            accountTierTagValue,
        ),
    );
}

/** Every way an entrypoint departs from tagging its tree with the tier tag for its stage. */
function violations(file: string, contents: string): readonly string[] {
    const reading = readTierTag(file, contents);
    const found: string[] = [];

    if (!reading.importsKey) {
        found.push(`does not import TIER_TAG_KEY from ${QUALIFIERS_MODULE}`);
    }

    if (reading.valueExpression === undefined) {
        found.push('does not call Tags.of(<the app it builds>).add(TIER_TAG_KEY, <value>)');

        return found;
    }

    const expected =
        file === ACCOUNT_APP
            ? 'accountTierTagValue()'
            : `tierTagValueForStage(${reading.stageIdentifier ?? '<stage>'})`;

    if (reading.valueExpression.replaceAll(/\s+/gu, '') !== expected) {
        found.push(`derives the value from \`${reading.valueExpression}\`, not \`${expected}\``);
    }

    return found;
}

const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

const apps = cdkApps();
const stageApps = apps.filter((app) => app !== ACCOUNT_APP);

describe('every CDK app tags its tree with kitchensink:tier (ADR-0065)', () => {
    it('finds the CDK apps by content, so a new one cannot opt out by omission', () => {
        expect(apps.length).toBeGreaterThanOrEqual(9);
        expect(apps).toContain(ACCOUNT_APP);
    });

    it.each(apps)('%s applies the tier tag to the app it constructs', (app) => {
        expect(violations(app, read(app))).toEqual([]);
    });

    it.each(
        stageApps.flatMap((app) =>
            [
                ['prod', 'prod'],
                ['sandbox', 'nonprod'],
                ['pr-1', 'nonprod'],
                ['pr-91', 'nonprod'],
                ['dev', 'nonprod'],
            ].map(([stage, tier]) => [app, stage, tier] as const),
        ),
    )('%s tags stage %s `%s`, the tier its bootstrap qualifier serves', (app, stage, tier) => {
        const { valueExpression } = readTierTag(app, read(app));

        expect(evaluate(valueExpression ?? 'undefined', stage ?? '')).toBe(tier);
        expect(tier).toBe(tierTagValue(qualifierForStage(stage ?? '')));
    });

    it('tags the account app `account` whatever stage it is handed: it has no stage', () => {
        const { valueExpression } = readTierTag(ACCOUNT_APP, read(ACCOUNT_APP));

        for (const stage of ['prod', 'sandbox', 'pr-1', 'anything']) {
            expect(evaluate(valueExpression ?? 'undefined', stage)).toBe('account');
        }
    });
});

describe('violations (negative controls: the guard can fail)', () => {
    const GOOD = `
        import { App, Tags } from 'aws-cdk-lib';
        import { kitchenSinkAppProps, resolveStage } from '@kitchensink/cdk-bootstrap/appProps';
        import { TIER_TAG_KEY, tierTagValueForStage } from '@kitchensink/cdk-bootstrap/qualifiers';
        const stage = resolveStage(process.env) ?? 'dev';
        const app = new App(kitchenSinkAppProps(stage));
        Tags.of(app).add(TIER_TAG_KEY, tierTagValueForStage(stage));
    `;

    it('accepts the wiring every stage app uses', () => {
        expect(violations('good.ts', GOOD)).toEqual([]);
    });

    it('rejects an app that never tags', () => {
        expect(violations('bad.ts', GOOD.replace(/Tags\.of\(app\)\.add.*\n/u, '')).join('\n')).toMatch(/Tags\.of/u);
    });

    it('rejects the tag mentioned only in a comment', () => {
        const source = GOOD.replace(
            /Tags\.of\(app\)\.add.*\n/u,
            '// Tags.of(app).add(TIER_TAG_KEY, tierTagValueForStage(stage));\n',
        );

        expect(violations('bad.ts', source).length).toBeGreaterThan(0);
    });

    it('rejects a literal key: the key has ONE authority', () => {
        expect(violations('bad.ts', GOOD.replace('add(TIER_TAG_KEY', "add('kitchensink:tier'")).join('\n')).toMatch(
            /Tags\.of/u,
        );
    });

    it('rejects a literal value, which would not follow the stage', () => {
        expect(violations('bad.ts', GOOD.replace('tierTagValueForStage(stage)', "'nonprod'")).join('\n')).toMatch(
            /derives the value/u,
        );
    });

    it('rejects a value derived from another stage than the one the App is built for', () => {
        const source = GOOD.replace('tierTagValueForStage(stage)', "tierTagValueForStage('prod')");

        expect(violations('bad.ts', source).join('\n')).toMatch(/derives the value/u);
    });

    it('rejects tagging some other construct than the App', () => {
        const source = GOOD.replace('Tags.of(app)', 'Tags.of(other)');

        expect(violations('bad.ts', source).length).toBeGreaterThan(0);
    });

    it('rejects a missing import of the key', () => {
        expect(
            violations('bad.ts', GOOD.replace('TIER_TAG_KEY, tierTagValueForStage', 'tierTagValueForStage')).join('\n'),
        ).toMatch(/import TIER_TAG_KEY/u);
    });
});
