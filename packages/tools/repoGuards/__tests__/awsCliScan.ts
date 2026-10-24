/**
 * Finds every AWS CLI call in a file's text, and says which IAM action each one needs.
 *
 * ## Why this is a scanner and not a list
 *
 * `GithubActionsAccessStack.test.ts` once held a hand-built table of "every AWS command a CI job runs". It was
 * written from the shell `aws <service> <verb>` calls it could see, so it missed a Node tool that shells the CLI
 * through `execFile` (`collectMetrics.mjs`), and a copy of a list cannot tell that the list is incomplete. The guard
 * built on this module (`awsCliObserveCoverage.test.ts`) reads the SOURCE instead, so a command a CI file gains
 * must either be in the table or fail with the file and line that runs it.
 *
 * ## Shapes recognised
 *
 * - Text: `aws [global flags] <service> <verb> …` in shell, YAML `run:` blocks and JS/TS strings and templates,
 *   with line continuations joined, `--region`/`--profile`-style flags allowed BEFORE the service, and commands
 *   found after `$(`, a backtick, `|`, `&&` and `;`.
 * - Argv: `execFile`/`execFileAsync`/`spawn`/`spawnSync`/any wrapper called as `fn('aws', [ … ])`, including an
 *   argv held in a variable declared in the same file (`const args = ['cloudwatch', …]; execFile('aws', args)`).
 *
 * ⛔ A call this module cannot read (a variable service, a spread-led argv, an argv built elsewhere) is REPORTED as
 * unresolved (`?`), never skipped: a scanner that drops what it cannot parse is the same hole as the list it
 * replaces. Comments are not code and are not scanned.
 *
 * Everything here is pure.
 */
import { withoutTsComments } from './sourceComments.js';

/** One AWS CLI call found in a file. */
export interface AwsInvocation {
    /** The CLI service word (`ecs`, `stepfunctions`), or `?` when the text names it with a variable. */
    readonly service: string;
    /** The CLI verb (`describe-services`, `wait`), or `?` when unreadable. */
    readonly verb: string;
    /** For `wait`, the waiter name (`tasks-stopped`); otherwise undefined. */
    readonly argument: string | undefined;
    /** 1-based line the command starts on. */
    readonly line: number;
}

/** What the IAM side of one invocation is. */
export type IamMapping =
    | { readonly kind: 'actions'; readonly actions: readonly string[] }
    | { readonly kind: 'local'; readonly reason: string }
    | { readonly kind: 'outOfScope'; readonly reason: string }
    | { readonly kind: 'unmapped'; readonly reason: string };

export type ScanLanguage = 'shell' | 'script';

const UNRESOLVED = '?';

/** Global flags that take no value. Every other `--flag` without `=` consumes the next word. */
const BOOLEAN_FLAGS = new Set([
    '--no-cli-pager',
    '--no-paginate',
    '--no-sign-request',
    '--no-verify-ssl',
    '--no-cli-auto-prompt',
    '--cli-auto-prompt',
    '--debug',
    '--version',
    '--help',
]);

/** A CLI service, verb or waiter word. Anything quoted, `$`-bearing or dynamic is not one. */
const LITERAL_WORD = /^[a-z][a-z0-9-]*$/u;

/**
 * Blanks shell/YAML comments, keeping offsets. A `#` starts a comment only at the start of a word and outside
 * quotes, so `$#`, `${#x}` and `"/a#b"` are code. Quote state resets at each newline: a YAML prose apostrophe
 * must not silence the rest of the file.
 *
 * @param text - Shell or YAML text.
 * @returns The text with comment bodies replaced by spaces.
 */
function withoutShellComments(text: string): string {
    let out = '';
    let quote = '';
    let inComment = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i] ?? '';
        const previous = text[i - 1] ?? '\n';

        if (char === '\n') {
            inComment = false;
            quote = '';
            out += char;
            continue;
        }

        if (inComment) {
            out += ' ';
            continue;
        }

        if (quote !== '') {
            if (char === '\\' && quote === '"') {
                out += char + (text[i + 1] ?? '');
                i += 1;
                continue;
            }

            quote = char === quote ? '' : quote;
            out += char;
            continue;
        }

        if (char === "'" || char === '"') {
            quote = char;
        } else if (char === '#' && /\s/u.test(previous)) {
            inComment = true;
            out += ' ';
            continue;
        }

        out += char;
    }

    return out;
}

/** 1-based line number of an offset. */
function lineAt(text: string, offset: number): number {
    let line = 1;

    for (let i = 0; i < offset; i += 1) {
        line += text[i] === '\n' ? 1 : 0;
    }

    return line;
}

/**
 * Reads one shell word starting at `from`, skipping blanks. Stops at a newline or an operator.
 *
 * @returns The raw word (quotes kept) and the offset after it, or undefined at the end of the command.
 */
function readShellWord(text: string, from: number): { readonly word: string; readonly end: number } | undefined {
    let i = from;

    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
        i += 1;
    }

    const start = i;
    let quote = '';

    while (i < text.length) {
        const char = text[i] ?? '';

        if (quote !== '') {
            quote = char === quote ? '' : quote;
            i += 1;
            continue;
        }

        if (char === "'" || char === '"') {
            quote = char;
            i += 1;
            continue;
        }

        if (/[\s;|&)`]/u.test(char)) {
            break;
        }

        i += 1;
    }

    return i === start ? undefined : { word: text.slice(start, i), end: i };
}

/** A literal CLI word, or `?`. A quoted or `$`-bearing word is not a literal. */
function literalOrUnresolved(word: string | undefined): string {
    return word !== undefined && LITERAL_WORD.test(word) ? word : UNRESOLVED;
}

/** Reads `<service> <verb> [waiter]` out of the words that follow `aws`, skipping global flags. */
function readCommand(
    nextWord: () => string | undefined,
): { readonly service: string; readonly verb: string; readonly argument: string | undefined } | undefined {
    const positional: string[] = [];
    let word = nextWord();

    while (word !== undefined && positional.length < 3) {
        if (word.startsWith('--')) {
            if (!word.includes('=') && !BOOLEAN_FLAGS.has(word)) {
                // The flag's value. A later positional is never mistaken for it because a value is consumed here.
                nextWord();
            }
        } else {
            positional.push(word);

            // Only a `wait` reads a third word, and only one that is not a flag.
            if (positional.length === 2 && positional[1] !== 'wait') {
                break;
            }
        }

        word = nextWord();
    }

    if (positional.length === 0) {
        return undefined;
    }

    const [service, verb, argument] = positional;

    return {
        service: literalOrUnresolved(service),
        verb: literalOrUnresolved(verb),
        argument: verb === 'wait' && argument !== undefined ? literalOrUnresolved(argument) : undefined,
    };
}

/**
 * True when the text before an `aws` on its logical line shows it sits inside a message, not a command: an `echo`,
 * a `printf` or a workflow annotation (`::error::`) whose string the match is in. A `$(` or a backtick starts a new
 * command, so `echo "arn: $(aws sns list-topics)"` is still a call, and so is `echo start; aws …`.
 */
function isShellProse(prefix: string): boolean {
    let quote = '';
    let segment = 0;

    for (let i = 0; i < prefix.length; i += 1) {
        const char = prefix[i] ?? '';

        if (char === '`' || (char === '$' && prefix[i + 1] === '(')) {
            segment = char === '`' ? i + 1 : i + 2;
        } else if (quote !== '') {
            quote = char === quote ? '' : quote;
        } else if (char === "'" || char === '"') {
            quote = char;
        } else if (char === ';' || char === '&' || char === '|') {
            segment = i + 1;
        }
    }

    return /(?:^|\s)(?:echo|printf)\b|::(?:error|warning|notice|debug|group)::/u.test(prefix.slice(segment));
}

/** True when the text before a template-string `aws` shows an exec-style call around it. */
function isExecContext(prefix: string): boolean {
    return /(?:\bexec\w*|\bspawn\w*|\bexeca\w*|\$)\s*\(?\s*[`'"]?[^`'"]*$/u.test(prefix);
}

/**
 * `aws …` in shell, YAML and string text.
 *
 * ⚠️ The lookbehind is what keeps `aws-actions/configure-aws-credentials`, `~/.aws/config`, `/usr/local/aws` and
 * `AWS_REGION` from reading as commands: a command word is not preceded by a name character, a dot or a slash.
 *
 * @param joined - The code with continuations joined (offsets unchanged).
 * @param original - The same code with newlines intact, for line numbers.
 */
function scanText(joined: string, original: string, language: ScanLanguage): AwsInvocation[] {
    const found: AwsInvocation[] = [];

    for (const match of joined.matchAll(/(?<![A-Za-z0-9_.$@/-])aws(?=[ \t])/gu)) {
        const prefix = joined.slice(joined.lastIndexOf('\n', match.index - 1) + 1, match.index);

        if (language === 'shell' && isShellProse(prefix)) {
            continue;
        }

        let cursor = match.index + match[0].length;
        const command = readCommand(() => {
            const read = readShellWord(joined, cursor);

            cursor = read?.end ?? cursor;

            return read?.word;
        });

        // In JS a dynamic word right after `aws` is almost always an error message (`aws ${args[0]} failed`); a real
        // shell-out through a string goes through an exec call, which is the only context that counts it unresolved.
        const dynamic = command?.service === UNRESOLVED || command?.verb === UNRESOLVED;

        if (command !== undefined && !(language === 'script' && dynamic && !isExecContext(prefix))) {
            found.push({ ...command, line: lineAt(original, match.index) });
        }
    }

    return found;
}

/** The element texts of the array literal whose `[` is at `open`, split at depth zero. Strings are skipped whole. */
function arrayElements(text: string, open: number): readonly string[] | undefined {
    const elements: string[] = [];
    let depth = 0;
    let start = open + 1;
    let quote = '';

    for (let i = open; i < text.length; i += 1) {
        const char = text[i] ?? '';

        if (quote !== '') {
            if (char === '\\') {
                i += 1;
            } else if (char === quote) {
                quote = '';
            }

            continue;
        }

        if (char === "'" || char === '"' || char === '`') {
            quote = char;
        } else if (char === '[' || char === '(' || char === '{') {
            depth += 1;
        } else if (char === ']' || char === ')' || char === '}') {
            depth -= 1;

            if (depth === 0) {
                elements.push(text.slice(start, i));

                return elements.map((element) => element.trim()).filter((element) => element !== '');
            }
        } else if (char === ',' && depth === 1) {
            elements.push(text.slice(start, i));
            start = i + 1;
        }
    }

    return undefined;
}

/** The value of a string literal with no interpolation, or undefined. */
function stringLiteral(element: string): string | undefined {
    const match = /^(['"`])([^'"`$\\]*)\1$/u.exec(element);

    return match?.[2];
}

/** Reads the CLI command out of an argv's elements. */
function commandFromArgv(
    elements: readonly string[],
): { readonly service: string; readonly verb: string; readonly argument: string | undefined } | undefined {
    let index = 0;

    // A spread (`...args`) hides the leading words: it cannot be read, so it is reported rather than dropped.
    if (elements[0]?.startsWith('...') === true) {
        return { service: UNRESOLVED, verb: UNRESOLVED, argument: undefined };
    }

    const words = (): string | undefined => {
        const element = elements[index];

        index += 1;

        return element === undefined ? undefined : (stringLiteral(element) ?? `\u0000${element}`);
    };

    // Dynamic elements surface as a NUL-prefixed word, which no literal check accepts.

    return readCommand(words);
}

/** What an `'aws'` call passes as argv: a literal array, or the name of a variable or parameter holding it. */
interface ArgvTarget {
    readonly elements: readonly string[] | undefined;
    readonly identifier: string | undefined;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*/u;

function argvTarget(text: string, afterComma: number): ArgvTarget {
    let i = afterComma;

    while (/\s/u.test(text[i] ?? '')) {
        i += 1;
    }

    if (text[i] === '[') {
        const elements = arrayElements(text, i);
        const spread =
            elements?.[0]?.startsWith('...') === true ? IDENTIFIER.exec(elements[0].slice(3))?.[0] : undefined;

        return spread === undefined ? { elements, identifier: undefined } : { elements: undefined, identifier: spread };
    }

    const identifier = IDENTIFIER.exec(text.slice(i))?.[0];

    if (identifier === undefined) {
        return { elements: undefined, identifier: undefined };
    }

    const declaration = new RegExp(`(?:const|let|var)\\s+${RegExp.escape(identifier)}\\b[^=;]*=\\s*\\[`, 'u').exec(
        text,
    );

    return {
        elements: declaration === null ? undefined : arrayElements(text, declaration.index + declaration[0].length - 1),
        identifier,
    };
}

/**
 * When an argv is a PARAMETER of the enclosing function (`function aws(args) { execFile('aws', [...args, …]) }`),
 * the commands are the literal arrays that function's callers pass. Returns each as an argv, with its line.
 */
function wrapperCalls(
    text: string,
    at: number,
    parameter: string,
): readonly { elements: readonly string[]; line: number }[] {
    const head = text.slice(0, at);
    const definitions = [
        ...head.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gu),
        ...head.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>/gu),
    ].sort((a, b) => a.index - b.index);
    const enclosing = definitions.at(-1);

    if (enclosing === undefined || !new RegExp(`\\b${RegExp.escape(parameter)}\\b`, 'u').test(enclosing[2] ?? '')) {
        return [];
    }

    const name = RegExp.escape(enclosing[1] ?? '');
    const calls: { elements: readonly string[]; line: number }[] = [];

    for (const call of text.matchAll(new RegExp(`(?<![\\w$.])(?<!function\\s+)${name}\\(\\s*\\[`, 'gu'))) {
        const elements = arrayElements(text, call.index + call[0].length - 1);

        if (elements !== undefined) {
            calls.push({ elements, line: lineAt(text, call.index) });
        }
    }

    return calls;
}

/** `fn('aws', [ … ])`, `fn('aws', argsVariable)` and a wrapper whose callers pass the literal arrays. */
function scanArgv(text: string): AwsInvocation[] {
    const found: AwsInvocation[] = [];
    const unresolved = (line: number): AwsInvocation => ({
        service: UNRESOLVED,
        verb: UNRESOLVED,
        argument: undefined,
        line,
    });

    for (const match of text.matchAll(/(['"`])aws\1\s*,\s*/gu)) {
        const target = argvTarget(text, match.index + match[0].length);
        const line = lineAt(text, match.index);

        if (target.elements !== undefined) {
            const command = commandFromArgv(target.elements);

            found.push(command === undefined ? unresolved(line) : { ...command, line });
            continue;
        }

        const calls = target.identifier === undefined ? [] : wrapperCalls(text, match.index, target.identifier);

        if (calls.length === 0) {
            found.push(unresolved(line));
        }

        for (const call of calls) {
            const command = commandFromArgv(call.elements);

            found.push(command === undefined ? unresolved(call.line) : { ...command, line: call.line });
        }
    }

    return found;
}

/**
 * Every AWS CLI call in a file, in source order.
 *
 * @param text - The file's contents.
 * @param language - `shell` for `.sh`/YAML (hash comments), `script` for JS/TS (slash comments, plus argv calls).
 * @returns Each call with its service, verb, optional waiter and starting line.
 */
export function scanAwsInvocations(text: string, language: ScanLanguage): readonly AwsInvocation[] {
    const code = language === 'shell' ? withoutShellComments(text) : withoutTsComments(text);
    const joined = code.replace(/\\\n/gu, '  ');
    const found = scanText(joined, code, language);

    if (language === 'script') {
        found.push(...scanArgv(code));
    }

    return found.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------------------------------------------
// CLI service + verb -> IAM action
// ---------------------------------------------------------------------------------------------------------------

/** CLI service words whose IAM prefix differs. */
const IAM_PREFIX: Readonly<Record<string, string>> = {
    stepfunctions: 'states',
    resourcegroupstaggingapi: 'tag',
    s3api: 's3',
};

/** Commands that run on the machine and call no AWS API. */
const LOCAL_SERVICES = new Set(['configure', 'help', 'history', 'cli-config']);

/** `aws s3 …` high-level commands expand to several S3 actions each; the S3 grants are asserted per bucket by name. */
const OUT_OF_SCOPE_SERVICES: Readonly<Record<string, string>> = {
    s3: 'high-level `aws s3` commands expand to several S3 actions; S3 grants are judged per bucket in GithubActionsAccessStack.test.ts',
};

/** Verbs whose IAM action is not the PascalCase of the verb. */
const VERB_ACTIONS: Readonly<Record<string, readonly string[]>> = {
    'lambda invoke': ['lambda:InvokeFunction'],
    'logs tail': ['logs:FilterLogEvents', 'logs:StartLiveTail'],
    'ecr get-login-password': ['ecr:GetAuthorizationToken'],
    's3api head-bucket': ['s3:ListBucket'],
    's3api head-object': ['s3:GetObject'],
};

/** The describe/get call a `wait` polls, per service. */
const WAITER_ACTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    ecs: {
        'services-stable': 'ecs:DescribeServices',
        'services-inactive': 'ecs:DescribeServices',
        'tasks-running': 'ecs:DescribeTasks',
        'tasks-stopped': 'ecs:DescribeTasks',
    },
    rds: {
        'db-instance-available': 'rds:DescribeDBInstances',
        'db-instance-deleted': 'rds:DescribeDBInstances',
        'db-cluster-available': 'rds:DescribeDBClusters',
        'db-cluster-deleted': 'rds:DescribeDBClusters',
        'db-snapshot-available': 'rds:DescribeDBSnapshots',
        'db-snapshot-deleted': 'rds:DescribeDBSnapshots',
    },
    ec2: {
        'instance-exists': 'ec2:DescribeInstances',
        'instance-running': 'ec2:DescribeInstances',
        'instance-stopped': 'ec2:DescribeInstances',
        'instance-terminated': 'ec2:DescribeInstances',
        'instance-status-ok': 'ec2:DescribeInstanceStatus',
    },
    cloudformation: {
        'stack-exists': 'cloudformation:DescribeStacks',
        'stack-create-complete': 'cloudformation:DescribeStacks',
        'stack-update-complete': 'cloudformation:DescribeStacks',
        'stack-delete-complete': 'cloudformation:DescribeStacks',
        'change-set-create-complete': 'cloudformation:DescribeChangeSet',
    },
    lambda: {
        'function-active': 'lambda:GetFunction',
        'function-active-v2': 'lambda:GetFunction',
        'function-updated': 'lambda:GetFunction',
        'function-updated-v2': 'lambda:GetFunction',
        'function-exists': 'lambda:GetFunction',
    },
    cloudwatch: { 'alarm-exists': 'cloudwatch:DescribeAlarms' },
    iam: {
        'role-exists': 'iam:GetRole',
        'policy-exists': 'iam:GetPolicy',
        'user-exists': 'iam:GetUser',
        'instance-profile-exists': 'iam:GetInstanceProfile',
    },
};

/** Segments that are acronyms in an IAM action name (`DescribeDBInstances`, not `DescribeDbInstances`). */
const ACRONYMS: Readonly<Record<string, string>> = { db: 'DB' };

/**
 * @param service - A CLI service word.
 * @returns The IAM prefix its actions carry (`stepfunctions` -> `states`).
 */
export function iamPrefixOf(service: string): string {
    return IAM_PREFIX[service] ?? service;
}

/** `describe-db-instances` -> `DescribeDBInstances`. */
function pascalCase(verb: string): string {
    return verb
        .split('-')
        .map((segment) => ACRONYMS[segment] ?? `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
        .join('');
}

/**
 * The IAM action(s) an invocation needs.
 *
 * `unmapped` is a FAILURE for the caller to report, never a skip: an unresolved word, or a `wait` whose polled call
 * is not in {@link WAITER_ACTIONS}, must be taught here rather than guessed.
 *
 * @param invocation - One scanned call.
 * @returns The actions, or why there are none.
 */
export function iamActionsFor(invocation: AwsInvocation): IamMapping {
    const { service, verb, argument } = invocation;

    if (service === UNRESOLVED || verb === UNRESOLVED) {
        return { kind: 'unmapped', reason: `the service or verb is not a literal (${service} ${verb})` };
    }

    if (LOCAL_SERVICES.has(service)) {
        return { kind: 'local', reason: `aws ${service} edits local CLI configuration` };
    }

    const outOfScope = OUT_OF_SCOPE_SERVICES[service];

    if (outOfScope !== undefined) {
        return { kind: 'outOfScope', reason: outOfScope };
    }

    const prefix = iamPrefixOf(service);

    if (verb === 'wait') {
        const polled = argument === undefined ? undefined : WAITER_ACTIONS[service]?.[argument];

        return polled === undefined
            ? { kind: 'unmapped', reason: `no mapping for waiter \`aws ${service} wait ${argument ?? ''}\`` }
            : { kind: 'actions', actions: [polled] };
    }

    const override = VERB_ACTIONS[`${service} ${verb}`];

    return { kind: 'actions', actions: override ?? [`${prefix}:${pascalCase(verb)}`] };
}
