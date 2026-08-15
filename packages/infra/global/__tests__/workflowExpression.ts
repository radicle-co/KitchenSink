/**
 * A parser + evaluator for the boolean subset of GitHub Actions `if:` / `${{ … }}` expressions.
 *
 * ## Pattern
 *
 * **Interpreter**, with the atom resolver supplied as a **Strategy** (`atomTruth`). The grammar this file
 * owns is only the boolean skeleton — `!`, `&&`, `||`, parentheses, and quote-aware call atoms such as
 * `contains(a, 'b')`. Everything inside an atom is OPAQUE to the parser and is resolved by the caller's
 * strategy, which is what lets two guards with completely different questions share one grammar:
 *
 *   - `workflowInvariants.test.ts` asks "can this be FALSE for certain under event E?" and answers
 *     `'unknown'` for anything it does not model, so a guess never invents an unreachable job.
 *   - `heavyE2eLoadTierGate.test.ts` asks "given this fully-specified event, does the job run?" and
 *     THROWS on an atom it does not model, so a new term silently changing the gate fails the suite.
 *
 * Those two policies are the reason the resolver is a parameter rather than baked in. The grammar itself is
 * one piece of knowledge (how GitHub parses a condition) and therefore lives in exactly one place — a second
 * copy would drift, and the copy that drifted would be the one nobody was watching.
 *
 * ## Three-valued on purpose
 *
 * `Truth` carries `'unknown'` because a caller may legitimately not model an atom. `conjoin` / `disjoin`
 * short-circuit through it exactly as GitHub's own `&&` / `||` would once the unknown side is resolved:
 * `false && unknown` is `false`, `true || unknown` is `true`. A caller that wants total evaluation asserts
 * the result is never `'unknown'` (see the load-tier gate guard).
 *
 * Every function here is pure.
 */

/** A three-valued truth: a definite value, or "this depends on an atom the caller did not model". */
export type Truth = 'true' | 'false' | 'unknown';

/** Logical NOT, with `unknown` absorbing. */
export function negate(value: Truth): Truth {
    if (value === 'true') {
        return 'false';
    }

    return value === 'false' ? 'true' : 'unknown';
}

/** Logical AND: a single definite `false` wins, mirroring GitHub's short-circuit. */
export function conjoin(left: Truth, right: Truth): Truth {
    if (left === 'false' || right === 'false') {
        return 'false';
    }

    return left === 'unknown' || right === 'unknown' ? 'unknown' : 'true';
}

/** Logical OR: a single definite `true` wins, mirroring GitHub's short-circuit. */
export function disjoin(left: Truth, right: Truth): Truth {
    if (left === 'true' || right === 'true') {
        return 'true';
    }

    return left === 'unknown' || right === 'unknown' ? 'unknown' : 'false';
}

/** Strip a single wrapping `${{ … }}`, which is optional on `if:` and carries no meaning. */
export function unwrap(condition: string): string {
    const trimmed = condition.trim();

    return (/^\$\{\{([\s\S]*)\}\}$/.exec(trimmed)?.[1] ?? trimmed).trim();
}

/** Index of the `)` closing the `(` at `open`, quote-aware. */
export function closingParen(expression: string, open: number): number {
    let depth = 0;

    for (let index = open; index < expression.length; index += 1) {
        const char = expression[index];

        if (char === "'" || char === '"') {
            const end = expression.indexOf(char, index + 1);

            index = end === -1 ? expression.length : end;
            continue;
        }

        if (char === '(') {
            depth += 1;
        }

        if (char === ')') {
            depth -= 1;

            if (depth === 0) {
                return index;
            }
        }
    }

    return expression.length - 1;
}

/**
 * Split an expression into `&&` / `||` / `!` / parens and opaque atoms.
 *
 * A `(` directly after an identifier is a CALL, so its argument list is swallowed into the atom — otherwise
 * `contains(a, 'b')` would shatter into fragments and the parse would be nonsense.
 */
export function tokenize(expression: string): readonly string[] {
    const tokens: string[] = [];
    let atom = '';

    function flush(): void {
        if (atom.trim() !== '') {
            tokens.push(atom.trim());
        }

        atom = '';
    }

    for (let index = 0; index < expression.length; index += 1) {
        const char = expression[index] as string;
        const pair = expression.slice(index, index + 2);

        if (char === "'" || char === '"') {
            const end = expression.indexOf(char, index + 1);
            const close = end === -1 ? expression.length - 1 : end;

            atom += expression.slice(index, close + 1);
            index = close;
            continue;
        }

        if (pair === '&&' || pair === '||') {
            flush();
            tokens.push(pair);
            index += 1;
            continue;
        }

        if (char === '!' && pair !== '!=') {
            flush();
            tokens.push('!');
            continue;
        }

        if (char === '(') {
            if (/[\w.]$/.test(atom)) {
                const end = closingParen(expression, index);

                atom += expression.slice(index, end + 1);
                index = end;
                continue;
            }

            flush();
            tokens.push('(');
            continue;
        }

        if (char === ')') {
            flush();
            tokens.push(')');
            continue;
        }

        atom += char;
    }

    flush();

    return tokens;
}

/**
 * Evaluate a condition, resolving each atom through `atomTruth`.
 *
 * `&&` binds tighter than `||`, as in GitHub's expression grammar.
 *
 * @param condition - The raw `if:` / `${{ … }}` text.
 * @param atomTruth - Resolver for one opaque atom. May throw to reject an unmodelled atom.
 * @returns The condition's truth under that resolver.
 */
export function evaluateCondition(condition: string, atomTruth: (atom: string) => Truth): Truth {
    const tokens = tokenize(unwrap(condition));
    let position = 0;

    function parseUnary(): Truth {
        const token = tokens[position];

        if (token === '!') {
            position += 1;

            return negate(parseUnary());
        }

        if (token === '(') {
            position += 1;

            const inner = parseDisjunction();

            if (tokens[position] === ')') {
                position += 1;
            }

            return inner;
        }

        position += 1;

        return token === undefined ? 'unknown' : atomTruth(token);
    }

    function parseConjunction(): Truth {
        let value = parseUnary();

        while (tokens[position] === '&&') {
            position += 1;
            value = conjoin(value, parseUnary());
        }

        return value;
    }

    function parseDisjunction(): Truth {
        let value = parseConjunction();

        while (tokens[position] === '||') {
            position += 1;
            value = disjoin(value, parseConjunction());
        }

        return value;
    }

    return parseDisjunction();
}

/**
 * Whether an `if` survives a SKIPPED dependency.
 *
 * GitHub skips every dependent of a skipped job unless the dependent opts out of the implicit `success()` —
 * which is exactly what `sandbox-deploy.yml`'s `deploy-recipe` does, and why it must keep doing it
 * (ADR-0010). Both guards that reason about `needs:` edges need this rule, so it lives with the grammar.
 */
export function isSkipTolerant(condition: string | undefined): boolean {
    return /always\(\)|!\s*cancelled\(\)|!\s*failure\(\)/.test(condition ?? '');
}
