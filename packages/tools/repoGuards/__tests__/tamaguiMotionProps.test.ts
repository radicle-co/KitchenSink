/**
 * G8 (ADR-0080): motion props reach a Tamagui element only through `motionPropsOf`.
 *
 * ⛔ WHY. The config carries an animation driver, which lets ANY Tamagui element animate when it is given an animation
 * prop, and the driver does not read the cook's reduce-motion setting. "Animate unless reduce motion is on" is a data-flow
 * claim no source reader can check, so the rule is structural instead: `animation`, `transition`, `transitionConfig`,
 * `animateOnly`, `disableAnimation`, `enterStyle` and `exitStyle` may appear on an element only as a spread of
 * `motionPropsOf(…)`, the one pure function that decides motion from the reduce-motion answer. They are never a
 * `styled()` default or variant, and an `enter:` or `exit:` modifier is never written in a style string.
 *
 * ⛔ IT ENUMERATES NOTHING. Every app module that imports Tamagui is read through the TypeScript parser (comments are not
 * code), so a prop in prose does not count and a renamed import cannot hide it.
 *
 * ✅ THE FIX FOR A FAILURE: spread `{...motionPropsOf(reduceMotion).sheet}` (or `.overlay`) instead of writing the prop.
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { appSourceModules, lineOf, parseModule } from './appSources.js';
import { valueBindingsOf } from './moduleBindings.js';
import { repoRoot } from './serviceSources.js';
import { TAMAGUI_MODULE, tamaguiStyledNames } from './tamaguiElements.js';

const MOTION_PROPS = new Set([
    'animation',
    'transition',
    'transitionConfig',
    'animateOnly',
    'disableAnimation',
    'enterStyle',
    'exitStyle',
]);

const MODIFIER = /(?:^|[\s$])(?:enter|exit):/u;

const MOTION_FUNCTION = 'motionPropsOf';

/** Whether an expression is a call to `motionPropsOf`, possibly read through property accesses. Pure. */
function isMotionPropsExpression(expression: ts.Expression): boolean {
    let current: ts.Expression = expression;

    while (ts.isPropertyAccessExpression(current)) {
        current = current.expression;
    }

    return (
        ts.isCallExpression(current) &&
        ts.isIdentifier(current.expression) &&
        current.expression.text === MOTION_FUNCTION
    );
}

/**
 * Every motion prop, `enter:`/`exit:` modifier, or `styled()` motion default in a module that imports Tamagui, other than a
 * spread of `motionPropsOf(…)`. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its repo-relative path.
 * @returns One `file:line text` entry per finding.
 */
export function tamaguiMotionPropFindings(source: string, fileName: string): readonly string[] {
    const file = parseModule(fileName, source);

    if (!valueBindingsOf(file, (specifier) => TAMAGUI_MODULE.test(specifier)).imported) {
        return [];
    }

    const styledNames = tamaguiStyledNames(file);
    const findings: string[] = [];

    const report = (node: ts.Node, why: string): void => {
        findings.push(`${fileName}:${lineOf(file, node)} ${why}`);
    };

    const modifierIn = (node: ts.Node): void => {
        const visit = (inner: ts.Node): void => {
            if (ts.isStringLiteralLike(inner) && MODIFIER.test(inner.text)) {
                report(inner, `an enter:/exit: modifier "${inner.text}"`);
            }

            ts.forEachChild(inner, visit);
        };

        visit(node);
    };

    const visit = (node: ts.Node, insideStyled: boolean): void => {
        if (ts.isJsxAttribute(node)) {
            const name = node.name.getText(file);

            if (MOTION_PROPS.has(name)) {
                report(node, `the motion prop ${name} is not a spread of ${MOTION_FUNCTION}`);
            } else if (node.initializer !== undefined) {
                modifierIn(node.initializer);
            }
        }

        if (ts.isJsxSpreadAttribute(node) && !isMotionPropsExpression(node.expression)) {
            // A spread of anything else may carry a motion prop; it is flagged only when it is an object literal that does.
            if (ts.isObjectLiteralExpression(node.expression)) {
                node.expression.properties.forEach((property) => {
                    if (property.name !== undefined && MOTION_PROPS.has(property.name.getText(file))) {
                        report(property, `the motion prop ${property.name.getText(file)} in a spread`);
                    }
                });
            }
        }

        const nowStyled =
            insideStyled ||
            (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && styledNames.has(node.expression.text));

        if (nowStyled && ts.isPropertyAssignment(node) && MOTION_PROPS.has(node.name.getText(file))) {
            report(node, `a styled() default or variant sets ${node.name.getText(file)}`);
        }

        if (nowStyled && ts.isStringLiteralLike(node) && MODIFIER.test(node.text)) {
            report(node, `an enter:/exit: modifier "${node.text}" in a styled() definition`);
        }

        ts.forEachChild(node, (child) => visit(child, nowStyled));
    };

    visit(file, false);

    return findings;
}

const NATIVE_LEAF = 'packages/apps/commise/ui/src/x/Part.native.tsx';
const TAMAGUI = `import { Sheet, styled, YStack } from 'tamagui';\n`;

describe('G8: tamaguiMotionPropFindings', () => {
    it.each([
        ['a literal animation prop', `${TAMAGUI}const a = <Sheet animation="sheet" />;`, 1],
        ['a literal transition prop', `${TAMAGUI}const a = <Sheet transition="sheet" />;`, 1],
        ['a transitionConfig prop', `${TAMAGUI}const a = <Sheet transitionConfig={{ type: 'direct' }} />;`, 1],
        [
            'animateOnly and disableAnimation',
            `${TAMAGUI}const a = <YStack animateOnly={['opacity']} disableAnimation />;`,
            2,
        ],
        [
            'enterStyle and exitStyle',
            `${TAMAGUI}const a = <YStack enterStyle={{ opacity: 0 }} exitStyle={{ opacity: 0 }} />;`,
            2,
        ],
        ['a spread of motionPropsOf', `${TAMAGUI}const a = <Sheet {...motionPropsOf(rm).sheet} />;`, 0],
        ['a spread of motionPropsOf, no member', `${TAMAGUI}const a = <Sheet {...motionPropsOf(rm)} />;`, 0],
        [
            'a spread of a variable, which could carry anything but is not an object literal',
            `${TAMAGUI}const a = <Sheet {...props} />;`,
            0,
        ],
        [
            'a spread of an object literal that carries a motion prop',
            `${TAMAGUI}const a = <Sheet {...{ animation: 'sheet' }} />;`,
            1,
        ],
        ['a styled() default', `${TAMAGUI}const A = styled(YStack, { animation: 'sheet' });`, 1],
        [
            'a styled() variant',
            `${TAMAGUI}const A = styled(YStack, { variants: { on: { true: { enterStyle: { opacity: 0 } } } } });`,
            1,
        ],
        ['an enter: modifier in a styled() string', `${TAMAGUI}const A = styled(YStack, { x: '$enter:1' });`, 1],
        ['an exit: modifier in a JSX string', `${TAMAGUI}const a = <YStack x="exit:0" />;`, 1],
        [
            'the words in prose and a comment',
            `${TAMAGUI}// transition="sheet"\nconst a = <YStack aria-label="Press enter to go on" />;`,
            0,
        ],
        ['a motion prop in a module that does not import Tamagui', `const a = <Other transition="x" />;`, 0],
        [
            'a renamed styled',
            `import { styled as s, YStack } from 'tamagui';\nconst A = s(YStack, { animation: 'x' });`,
            1,
        ],
        ['the function that builds the props', `${TAMAGUI}export const f = () => ({ transition: 'sheet' });`, 0],
    ] as const)('%s', (_shape, source, expected) => {
        expect(tamaguiMotionPropFindings(source, NATIVE_LEAF)).toHaveLength(expected);
    });

    it('finds none in the tree', () => {
        const findings = appSourceModules().flatMap((file) =>
            tamaguiMotionPropFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file),
        );

        expect(findings).toEqual([]);
    });
});
