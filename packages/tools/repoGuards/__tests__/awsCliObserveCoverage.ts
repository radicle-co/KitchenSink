/**
 * The pure core of the CI observe-grant coverage guard: given file texts and the enumerated command table, which AWS
 * calls are unlisted, unreadable, or listed but never made?
 *
 * Three findings, each naming the file and line (or the table row) so a failure says WHO to fix:
 *
 * - `missing`: a scanned call needs an observe-service action that is in neither the command table nor the teardown
 *   set. Either the grant is genuinely missing from the CI roles (a security decision) or the table lags a grant that
 *   exists (add the row).
 * - `unreadable`: a call the scanner could not resolve, or a `wait` it has no mapping for. Never skipped.
 * - `stale`: a table row (or teardown action) that no scanned file calls and that is not declared SDK-only. A row
 *   nothing calls is a grant nothing needs.
 *
 * ⚠️ The SDK-only escape hatch is a declaration that names the FILE that calls the action through the SDK, and this
 * module checks that the file exists in the scanned set and imports the matching `<Verb>Command` — so it cannot rot
 * into a free pass.
 */
import { OBSERVE_SERVICE } from './ciAwsCommands.js';
import { iamActionsFor, iamPrefixOf, scanAwsInvocations, type ScanLanguage } from './awsCliScan.js';

/** One file as the guard reads it. */
export interface CoverageFile {
    /** Repo-relative path. */
    readonly file: string;
    readonly contents: string;
}

/** An action CI makes through an SDK client, not the CLI, with the file that makes it. */
export interface SdkOnlyDeclaration {
    /** Repo-relative file that calls the action. */
    readonly file: string;
    /** The SDK command class it constructs. */
    readonly command: string;
}

export interface CoverageInput {
    readonly files: readonly CoverageFile[];
    /** Every action a table row grants, with the caller prose of its first row. */
    readonly rows: readonly { readonly caller: string; readonly action: string }[];
    /** The teardown actions (held by their own table). */
    readonly teardown: ReadonlySet<string>;
    readonly sdkOnly: Readonly<Record<string, SdkOnlyDeclaration>>;
}

/** The scanner language for a file, or undefined when the file is not scanned. */
export function languageOf(file: string): ScanLanguage | undefined {
    // `package.json` scripts are shell lines (`docker:push` logs in to ECR with the CLI).
    if (/\.(sh|ya?ml)$/u.test(file) || /(^|\/)package\.json$/u.test(file)) {
        return 'shell';
    }

    return /\.(mjs|cjs|js|ts|tsx)$/u.test(file) ? 'script' : undefined;
}

const lower = (action: string): string => action.toLowerCase();

/**
 * @param input - The files, the table and the SDK-only declarations.
 * @returns One human-readable finding per problem; empty when the table equals what the files call.
 */
export function coverageFindings(input: CoverageInput): readonly string[] {
    const findings: string[] = [];
    const listed = new Set([...input.rows.map((row) => lower(row.action)), ...[...input.teardown].map(lower)]);
    const called = new Set<string>();

    for (const { file, contents } of input.files) {
        const language = languageOf(file);

        // The cheap prefilter: a file that never says `aws` cannot call it, and scanning every tracked file is slow.
        if (language === undefined || !contents.includes('aws')) {
            continue;
        }

        for (const invocation of scanAwsInvocations(contents, language)) {
            const where = `${file}:${invocation.line}`;
            const mapping = iamActionsFor(invocation);

            if (mapping.kind === 'unmapped') {
                // An unresolved word could be any service; a known service is only our concern when it is an observe one.
                const mayObserve =
                    invocation.service === '?' || OBSERVE_SERVICE.test(`${iamPrefixOf(invocation.service)}:`);

                if (mayObserve) {
                    findings.push(
                        `unreadable: ${where} runs aws ${invocation.service} ${invocation.verb}: ${mapping.reason}`,
                    );
                }

                continue;
            }

            if (mapping.kind !== 'actions') {
                continue;
            }

            for (const action of mapping.actions) {
                if (!OBSERVE_SERVICE.test(action)) {
                    continue;
                }

                called.add(lower(action));

                if (!listed.has(lower(action))) {
                    findings.push(
                        `missing: ${where} runs aws ${invocation.service} ${invocation.verb}${invocation.argument === undefined ? '' : ` ${invocation.argument}`} and needs ${action}, which is in neither the command table nor the teardown set`,
                    );
                }
            }
        }
    }

    const fileTexts = new Map(input.files.map((f) => [f.file, f.contents]));

    for (const [action, declaration] of Object.entries(input.sdkOnly)) {
        const text = fileTexts.get(declaration.file);

        if (text === undefined) {
            findings.push(`sdk-only: ${action} names ${declaration.file}, which is not in the scanned set`);
        } else if (!text.includes(declaration.command)) {
            findings.push(`sdk-only: ${action} names ${declaration.file}, which never mentions ${declaration.command}`);
        }

        if (called.has(lower(action))) {
            findings.push(`sdk-only: ${action} is declared SDK-only but a scanned file calls it through the CLI`);
        }
    }

    const sdk = new Set(Object.keys(input.sdkOnly).map(lower));
    const seen = new Set<string>();

    for (const { caller, action } of input.rows) {
        if (!seen.has(lower(action)) && !called.has(lower(action)) && !sdk.has(lower(action))) {
            findings.push(`stale: the row "${caller}" names ${action}, but no scanned file calls it`);
        }

        seen.add(lower(action));
    }

    for (const action of input.teardown) {
        if (!called.has(lower(action)) && !sdk.has(lower(action))) {
            findings.push(`stale: the teardown set names ${action}, but no scanned file calls it`);
        }
    }

    return findings;
}
