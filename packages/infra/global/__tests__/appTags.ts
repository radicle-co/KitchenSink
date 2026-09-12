/**
 * @module __tests__/appTags — reading the `Environment` tag out of a CDK app entrypoint, by AST.
 *
 * ⛔ A PLAIN HELPER, not a test file, and that distinction is the reason this module exists.
 * `environmentTagScheme.test.ts` used to import this from `environmentTagCoverage.test.ts` — the only
 * test-imports-test edge in the directory — which silently re-collected that file's whole suite inside the
 * importer. Measured: 12 tests ran twice, and a failure in them was attributed to whichever file happened
 * to be running. The convention here is a helper module (`cdkApps.ts`, `serviceSources.ts`); this follows it.
 *
 * ## Why the AST, not `includes`
 *
 * Every entrypoint contains PROSE about `Tags.of(app)` — the paragraph explaining why the commit stamp is a
 * stack tag rather than an aspect. A textual gate accepts that comment as evidence and passes an app whose
 * only mention of the tag is the sentence explaining a different one.
 */
import ts from 'typescript';

import { visit } from './serviceSources.js';

/** The tag key ADR-0005's teardown selector reads. */
export const ENVIRONMENT_TAG = 'Environment';

/**
 * Whether a source file applies `Tags.of(<the app it built>).add(<key>, …)`.
 *
 * Three things are required together, each ruling out a real way of being wrong:
 *   - the call exists as a CALL, so the prose about `Tags.of(app)` is not evidence;
 *   - the receiver is the identifier bound to `new App(...)`, so tagging some other construct does not count;
 *   - the first argument is the literal key, so tagging a different key does not count.
 *
 * ⚠️ It returns the tag's VALUE EXPRESSION rather than a boolean, and `tagsKeyOnApp` below is the boolean
 * reading of it. The extra fact is what lets `environmentTagScheme.test.ts` ask the question this predicate
 * cannot — not "is there a tag" but "what VALUE does it produce, and would the teardown match it" — without
 * a second parser that could disagree with this one about where the tag is.
 *
 * @param source - The entrypoint's text.
 * @param file - Its path, for the parser's diagnostics.
 * @param key - The tag key to look for.
 * @returns The source text of the tag's value argument, or `undefined` when the app is not tagged with
 *          `key` at all. Pure.
 */
export function appTagValueSource(source: string, file: string, key: string): string | undefined {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    let appBinding: string | undefined;
    const tagged = new Map<string, string>();

    visit(parsed, (node) => {
        // `const app = new App();` — the identifier this entrypoint binds its app to.
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            ts.isNewExpression(node.initializer) &&
            ts.isIdentifier(node.initializer.expression) &&
            node.initializer.expression.text === 'App'
        ) {
            appBinding = node.name.text;
        }

        // `Tags.of(<receiver>).add('Environment', <value>)` — matched as a shape, never as text.
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
            return;
        }

        if (node.expression.name.text !== 'add') {
            return;
        }

        const [tagKey, tagValue] = node.arguments;

        if (tagKey === undefined || !ts.isStringLiteral(tagKey) || tagKey.text !== key) {
            return;
        }

        const receiverCall = node.expression.expression;

        if (!ts.isCallExpression(receiverCall) || !ts.isPropertyAccessExpression(receiverCall.expression)) {
            return;
        }

        if (
            receiverCall.expression.name.text !== 'of' ||
            !ts.isIdentifier(receiverCall.expression.expression) ||
            receiverCall.expression.expression.text !== 'Tags'
        ) {
            return;
        }

        const [receiver] = receiverCall.arguments;

        if (receiver !== undefined && ts.isIdentifier(receiver) && tagValue !== undefined) {
            tagged.set(receiver.text, tagValue.getText(parsed));
        }
    });

    return appBinding === undefined ? undefined : tagged.get(appBinding);
}

/**
 * Whether an app applies `Environment` to the app it constructs — the key ADR-0005's teardown selector reads.
 *
 * @param source - The entrypoint's text.
 * @param file - Its path, for the parser's diagnostics.
 * @returns True when the file tags the app it builds with `Environment`. Pure.
 */
export function tagsEnvironmentOnApp(source: string, file: string): boolean {
    return appTagValueSource(source, file, ENVIRONMENT_TAG) !== undefined;
}
