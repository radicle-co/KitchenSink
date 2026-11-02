/**
 * Who imports `SurfaceToneScope` (ADR-0080 §1, H3). See `surfaceToneScopeOwnership.test.ts` for why only `ToneScope` may.
 *
 * @pattern Specification — one predicate over a parsed module, and the closed list of files still owed a move
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import { reExportsOf, specifiersOf, valueBindingsOf } from './moduleBindings.js';

const UI = 'packages/apps/commise/ui/src/';

/** The one module that states a surface's tone to both halves. */
export const SURFACE_TONE_SCOPE_OWNER = `${UI}surfaceTone/ToneScope.native.tsx`;

/** The overlay roots that still state the JS half alone. Each moves to `ToneScope` with its port, and leaves this list. */
export const SURFACE_TONE_SCOPE_PENDING: readonly string[] = [
    `${UI}dialogFrame/DialogFrame.native.tsx`,
    `${UI}sheet/BottomSheetPanel.native.tsx`,
    `${UI}sheet/FullScreenSheet.native.tsx`,
];

const SCOPE = 'SurfaceToneScope';

const CONTEXT_MODULE = /(?:^|\/)surfaceToneContext(?:\.js)?$/u;

/**
 * Every value import, re-export or namespace member of `SurfaceToneScope`. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its repo-relative path.
 * @returns One `file:line text` entry per use.
 */
export function surfaceToneScopeImports(source: string, fileName: string): readonly string[] {
    const file = parseModule(fileName, source);
    const isContext = (specifier: string): boolean => CONTEXT_MODULE.test(specifier);
    const bindings = valueBindingsOf(file, isContext);
    const found: ts.Node[] = [...specifiersOf(bindings, SCOPE)];

    found.push(
        ...reExportsOf(file, isContext).named.filter(
            (element) => (element.propertyName ?? element.name).text === SCOPE,
        ),
    );

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            node.name.text === SCOPE &&
            ts.isIdentifier(node.expression) &&
            bindings.namespaces.has(node.expression.text)
        ) {
            found.push(node);
        }

        ts.forEachChild(node, visit);
    };

    if (bindings.namespaces.size > 0) {
        visit(file);
    }

    return found.map((node) => `${fileName}:${lineOf(file, node)} ${node.getText(file)}`);
}
