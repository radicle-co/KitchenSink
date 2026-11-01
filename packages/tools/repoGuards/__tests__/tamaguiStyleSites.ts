/**
 * The places a module styles a Tamagui element, and the one policy every Tamagui style guard applies over them: the
 * attributes on each Tamagui element, every property inside each Tamagui `styled(…)` configuration, and every part of
 * a configuration the walk cannot read, which is ALWAYS a finding (fail closed). A guard supplies only its predicate.
 *
 * @pattern Template Method — the walk and the fail-closed rule are fixed here; each guard supplies the two predicates
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import {
    isTamaguiStyledCall,
    tamaguiElementNames,
    tamaguiOpeningElements,
    tamaguiStyledNames,
    type StyledExportsOf,
} from './tamaguiElements.js';
import { styledConfig, type StyleProperty } from './tamaguiStyleObjects.js';

/** The one module whose `.resolve` is readable: the design-system Text (ADR-0080 §8). */
const SCALED_TEXT_MODULE = /(?:^|\/)packages\/apps\/commise\/ui\/src\/text\/Text\.native\.tsx$/u;

/** A Tamagui 3 component resolver: `X.resolve(fn)`, whose function can return any style, so no guard can read it. */
function isResolverCall(node: ts.Node): node is ts.CallExpression {
    return (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'resolve' &&
        node.arguments.length === 1 &&
        node.arguments[0] !== undefined &&
        (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))
    );
}

/**
 * The design-system Text's resolver: in that one module, an arrow whose whole body is a call to `scaledTypeMetrics`, the
 * pure, tested function that owns the type-scaling arithmetic. Every other resolver is unreadable, so a finding.
 */
function isScaledTypeResolver(call: ts.CallExpression): boolean {
    const [resolver] = call.arguments;

    return (
        resolver !== undefined &&
        ts.isArrowFunction(resolver) &&
        SCALED_TEXT_MODULE.test(call.getSourceFile().fileName) &&
        ts.isCallExpression(resolver.body) &&
        ts.isIdentifier(resolver.body.expression) &&
        resolver.body.expression.text === 'scaledTypeMetrics'
    );
}

/** A guard's rule: which element attributes and which `styled(…)` properties it refuses. */
export interface StyleSiteRule {
    readonly attribute: (attribute: ts.JsxAttributeLike, file: ts.SourceFile) => boolean;
    readonly property: (property: StyleProperty) => boolean;
}

/**
 * Every finding of one rule in one module, plus every unreadable `styled(…)` part and every `.resolve(…)` resolver but the
 * design-system Text's one (`isScaledTypeResolver`). Pure, given `styledExportsOf`.
 *
 * @param source - The module's text.
 * @param fileName - Its path.
 * @param styledExportsOf - Which names a design-system subpath exports as Tamagui `styled(…)` components.
 * @param rule - The guard's predicates.
 * @returns One `file:line text` entry per finding.
 */
export function styleSiteFindings(
    source: string,
    fileName: string,
    styledExportsOf: StyledExportsOf,
    rule: StyleSiteRule,
): readonly string[] {
    const file = parseModule(fileName, source);
    const findings: string[] = [];

    const report = (node: ts.Node): void => {
        findings.push(`${fileName}:${lineOf(file, node)} ${node.getText(file)}`);
    };

    for (const element of tamaguiOpeningElements(file, tamaguiElementNames(file, styledExportsOf))) {
        element.attributes.properties.filter((attribute) => rule.attribute(attribute, file)).forEach(report);
    }

    const styledNames = tamaguiStyledNames(file);

    const visit = (node: ts.Node): void => {
        if (isResolverCall(node) && !isScaledTypeResolver(node)) {
            report(node);
        }

        if (isTamaguiStyledCall(node, styledNames)) {
            const { properties, unreadable } = styledConfig(node);

            unreadable.forEach(report);
            properties.filter(rule.property).forEach(({ node: property }) => {
                report(property);
            });

            return;
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return findings;
}
