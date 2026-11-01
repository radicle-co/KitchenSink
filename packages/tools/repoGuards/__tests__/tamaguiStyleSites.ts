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

/**
 * A reach for a Tamagui component's `resolve`: `X.resolve` or `X['resolve']`, where `X` is a name the module binds to a
 * Tamagui component. Its function can return any style, so no guard can read it. Matching the REFERENCE, not one call
 * shape, catches a named callback, `.call`, and a resolver taken out first (GATE SCQ-1).
 */
function resolverReference(node: ts.Node, components: ReadonlySet<string>): boolean {
    const owner = ts.isPropertyAccessExpression(node)
        ? node.name.text === 'resolve'
            ? node.expression
            : undefined
        : ts.isElementAccessExpression(node) &&
            ts.isStringLiteralLike(node.argumentExpression) &&
            node.argumentExpression.text === 'resolve'
          ? node.expression
          : undefined;

    return owner !== undefined && ts.isIdentifier(owner) && components.has(owner.text);
}

/**
 * The design-system Text's resolver: in that one module, an arrow whose whole body is a call to `scaledTypeMetrics`, the
 * pure, tested function that owns the type-scaling arithmetic. Every other resolver is unreadable, so a finding.
 */
function isScaledTypeResolver(reference: ts.Node): boolean {
    const call = reference.parent;

    if (!ts.isCallExpression(call) || call.expression !== reference || call.arguments.length !== 1) {
        return false;
    }

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

    const components = tamaguiElementNames(file, styledExportsOf);

    for (const element of tamaguiOpeningElements(file, components)) {
        element.attributes.properties.filter((attribute) => rule.attribute(attribute, file)).forEach(report);
    }

    const styledNames = tamaguiStyledNames(file);

    const visit = (node: ts.Node): void => {
        if (resolverReference(node, components) && !isScaledTypeResolver(node)) {
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
