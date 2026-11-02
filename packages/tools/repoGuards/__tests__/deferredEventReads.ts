/**
 * The deferred-event detector: a handler's event read inside a callback that runs LATER.
 *
 * React Native's renderer POOLS the synthetic event it hands a handler: when the handler returns, the event is released
 * and its `nativeEvent` becomes `null` (`ReactFabric-dev.js`, `executeDispatchesAndReleaseTopLevel` then `release`, whose
 * destructor nulls it). So `onLayout={(event) => setBox((previous) => next(previous, event.nativeEvent.layout))}` reads
 * `event` inside the state updater, which React runs during RENDER, after the release: `Cannot read property 'layout' of
 * null` (qa-ios, about one text-size switch in ten). The value must be read in the handler, synchronously, and passed in.
 *
 * One flagged use is: a property access `x.nativeEvent` where `x` is a PARAMETER of an enclosing function and at least
 * one other function sits between the access and that parameter's function (an updater, a timer, a promise callback, a
 * `.map` callback). Destructuring the event in the parameter list (`({ nativeEvent }) => ...`) copies it at the call and
 * is not flagged. A callback that is genuinely synchronous (a `.map` over the layout) is flagged too: read the value into
 * a `const` first, which is also the form that survives a later refactor into an updater.
 *
 * @pattern Specification — one predicate over a parsed module, shared by the guard and its fixture table
 */
import ts from 'typescript';

import { parseModule } from './appSources.js';

/** One flagged use. */
export interface DeferredEventRead {
    readonly line: number;
    readonly text: string;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node)
    );
}

function declaresParameter(fn: ts.FunctionLikeDeclaration, name: string): boolean {
    return fn.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name);
}

/**
 * Every `x.nativeEvent` read inside a function nested in the function that owns `x`.
 *
 * @param text - The module's source.
 * @param file - Its path (for the parser's script kind).
 * @returns The flagged uses, in source order. Pure.
 */
export function deferredEventReads(text: string, file: string): readonly DeferredEventRead[] {
    const source = parseModule(file, text);
    const found: DeferredEventRead[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'nativeEvent' && ts.isIdentifier(node.expression)) {
            const name = node.expression.text;
            let crossed = false;

            for (let up: ts.Node | undefined = node.parent; up !== undefined; up = up.parent) {
                if (!isFunctionLike(up)) {
                    continue;
                }

                if (declaresParameter(up, name)) {
                    if (crossed) {
                        found.push({
                            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                            text: node.getText(source),
                        });
                    }

                    break;
                }

                crossed = true;
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return found;
}
