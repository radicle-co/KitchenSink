/**
 * How a Tamagui value names a style that depends on a STATE, shared by the Tamagui guards (ADR-0080). Tamagui 3.1.9 has
 * no `pressStyle` or `hoverStyle` prop: a state style is a modifier inside a value (`opacity="0.4 disabled:0.4"`), or a
 * key of the object form (`opacity={{ base: 1, disabled: 0.4 }}`). Tamagui splits a value on whitespace and reads the
 * text before a token's last `:` as its modifiers (`@tamagui/web` `mergeVariants.ts`), and `canonicalClauseModifier`
 * is its own alias table (`active` and `pressed` are `press`, `starting` is `enter`, `ending` is `exit`), so a spelling
 * Tamagui adds is read here too.
 *
 * @pattern Specification — one predicate over a modifier, applied to a value
 */
import { canonicalClauseModifier, canonicalStateModifierNames } from '@tamagui/style-grammar/runtime';
import ts from 'typescript';

/** Whether a modifier is an interaction state (`hover`, `press`, `focus`, `disabled`, `enter`, `exit`, or a group's). Pure. */
export function isStateModifier(modifier: string): boolean {
    const canonical = canonicalClauseModifier(modifier);

    return canonicalStateModifierNames.includes(canonical) || canonical.startsWith('group-');
}

/** Whether a flat value carries a modifier `matches` accepts. Pure. */
export function textHasModifier(text: string, matches: (modifier: string) => boolean): boolean {
    return text
        .split(/\s+/u)
        .filter((token) => token.includes(':'))
        .some((token) => token.slice(0, token.lastIndexOf(':')).split(':').some(matches));
}

/**
 * Whether an expression names a modifier `matches` accepts: in any string or template text inside it, or as a key of
 * an object literal inside it. Pure.
 */
export function valueHasModifier(expression: ts.Expression, matches: (modifier: string) => boolean): boolean {
    let found = false;

    const visit = (node: ts.Node): void => {
        if (
            (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) &&
            textHasModifier(node.text, matches)
        ) {
            found = true;
        }

        if (
            ts.isPropertyAssignment(node) &&
            (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
            matches(node.name.text)
        ) {
            found = true;
        }

        ts.forEachChild(node, visit);
    };

    visit(expression);

    return found;
}
