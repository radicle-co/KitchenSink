/**
 * The AWS SDK calls a Lambda handler can make, read out of its source by the TypeScript checker, as the IAM actions
 * AWS authorizes them under.
 *
 * The walk starts at the handler module and follows every call into the declaration it resolves to, inside this
 * package. An SDK v3 call is a `new <Name>Command(…)`; the class is identified by the checker's TYPE, so a command
 * destructured from a lazy `await import('@aws-sdk/client-sfn')` is found the same as a static import.
 *
 * ⚠️ ONE NARROWING, because without it the reach would be wider than the code. A factory such as `createRdsApi`
 * returns an object of methods, and the reclaim uses one of them: `ReclaimPorts` types `rds` as `{ listInstances }`.
 * Where a factory call has a contextual type (the port it is assigned to), only the methods that type names are
 * walked. A property whose value is NOT a function is always walked, because it runs when the object is built.
 *
 * ⚠️ ONE TABLE OF IMPLIED PERMISSIONS. Some calls are authorized as a second action besides their own name, which no
 * reading of the name can know: `DescribeStacks` with no `StackName` also needs `cloudformation:ListStacks`, and it is
 * evaluated on `stack/*\/*` — the call the midnight reclaim was denied three times on its first night.
 *
 * @pattern Visitor — a recursive walk over the checker's AST, following calls into the declarations they resolve to
 */
import path from 'node:path';

import ts from 'typescript';

/**
 * The IAM service prefix of each SDK v3 client package, keyed by the package's name under `@aws-sdk/`. The prefix is
 * not always the client's name (`eventbridge` → `events`, `sfn` → `states`), so it is written down; a client missing
 * here throws rather than being guessed.
 */
const IAM_SERVICE_OF_CLIENT: Readonly<Record<string, string>> = {
    'client-cloudformation': 'cloudformation',
    'client-ec2': 'ec2',
    'client-ecs': 'ecs',
    'client-eventbridge': 'events',
    'client-rds': 'rds',
    'client-sfn': 'states',
    'client-ssm': 'ssm',
};

/** A second action AWS authorizes a call under when the call leaves out one request field. */
interface ImpliedPermission {
    /** The call's own action. */
    readonly action: string;
    /** The request field whose absence brings the second action in. */
    readonly whenOmitted: string;
    /** The second action. */
    readonly alsoRequires: string;
    /** The resource AWS evaluates the second action on, with `{region}` and `{account}` to fill in. */
    readonly evaluatedOn: string;
    /** Where AWS says so. */
    readonly source: string;
}

const IMPLIED_PERMISSIONS: readonly ImpliedPermission[] = [
    {
        action: 'cloudformation:DescribeStacks',
        whenOmitted: 'StackName',
        alsoRequires: 'cloudformation:ListStacks',
        // The resource in the AccessDenied the reclaim role received on 2026-10-14.
        evaluatedOn: 'arn:aws:cloudformation:{region}:{account}:stack/*/*',
        // "If you don't pass a parameter to StackName … This requires ListStacks and DescribeStacks permissions."
        source: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStacks.html',
    },
];

/** One IAM permission a handler's code needs. */
export interface RequiredPermission {
    readonly action: string;
    /** The resource AWS evaluates it on, when that is known; otherwise any resource the role grants it on. */
    readonly evaluatedOn?: string;
    /** `<file>:<line>` of the call, for the failure message. */
    readonly site: string;
}

/** The node types a call can resolve to and the walk can enter. */
type Walkable = ts.FunctionLikeDeclaration;

/**
 * The SDK permissions reachable from `entryFile`.
 *
 * @param program - A program whose roots include `entryFile`.
 * @param entryFile - The handler module, absolute.
 * @param scopeDir - Only declarations under this directory are entered (never `node_modules`).
 * @returns The permissions, one per action and resource, sorted by action. Pure over the program.
 * @throws Error for a command from a client {@link IAM_SERVICE_OF_CLIENT} does not name.
 */
export function sdkPermissionsReachedFrom(
    program: ts.Program,
    entryFile: string,
    scopeDir: string,
): readonly RequiredPermission[] {
    const checker = program.getTypeChecker();
    const entry = program.getSourceFile(entryFile);

    if (entry === undefined) {
        throw new Error(`${entryFile} is not in the program`);
    }

    const found = new Map<string, RequiredPermission>();
    const walked = new Set<string>();

    const site = (node: ts.Node): string => {
        const source = node.getSourceFile();

        return `${path.relative(scopeDir, source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    };

    const record = (permission: RequiredPermission): void => {
        const key = `${permission.action} ${permission.evaluatedOn ?? ''}`;

        if (!found.has(key)) {
            found.set(key, permission);
        }
    };

    const inScope = (node: ts.Node): boolean => {
        const file = node.getSourceFile();

        return (
            !file.isDeclarationFile && !file.fileName.includes('/node_modules/') && file.fileName.startsWith(scopeDir)
        );
    };

    /** The function a callee or a reference resolves to, when it is one the walk may enter. */
    const resolveFunction = (expression: ts.Expression): Walkable | undefined => {
        let symbol = checker.getSymbolAtLocation(expression);

        if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
            symbol = checker.getAliasedSymbol(symbol);
        }

        const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];

        if (declaration === undefined || !inScope(declaration)) {
            return undefined;
        }

        if (ts.isFunctionLike(declaration) && 'body' in declaration && declaration.body !== undefined) {
            return declaration as Walkable;
        }

        if (
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer !== undefined &&
            (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
        ) {
            return declaration.initializer;
        }

        return undefined;
    };

    const recordCommand = (node: ts.NewExpression): void => {
        const declaration = checker.getTypeAtLocation(node.expression).getSymbol()?.declarations?.[0];
        const client = /\/@aws-sdk\/(client-[a-z0-9-]+)\//u.exec(declaration?.getSourceFile().fileName ?? '')?.[1];
        const name = checker.getTypeAtLocation(node.expression).getSymbol()?.getName() ?? '';

        if (client === undefined || !name.endsWith('Command')) {
            return;
        }

        const service = IAM_SERVICE_OF_CLIENT[client];

        if (service === undefined) {
            throw new Error(
                `${site(node)}: @aws-sdk/${client} has no IAM service prefix in IAM_SERVICE_OF_CLIENT — add it, from ` +
                    "the service's page in the Service Authorization Reference",
            );
        }

        const action = `${service}:${name.slice(0, -'Command'.length)}`;
        const [input] = node.arguments ?? [];
        const states = (field: string): boolean =>
            input !== undefined &&
            ts.isObjectLiteralExpression(input) &&
            input.properties.some((property) => property.name !== undefined && property.name.getText() === field);

        record({ action, site: site(node) });

        for (const implied of IMPLIED_PERMISSIONS) {
            if (implied.action === action && !states(implied.whenOmitted)) {
                record({ action: implied.alsoRequires, evaluatedOn: implied.evaluatedOn, site: site(node) });
            }
        }
    };

    /** The property names a contextual type declares, or `undefined` when it narrows nothing. */
    const namesOf = (type: ts.Type | undefined): ReadonlySet<string> | undefined => {
        const names = type?.getProperties().map((property) => property.getName()) ?? [];

        return names.length === 0 ? undefined : new Set(names);
    };

    const isFunctionValued = (property: ts.ObjectLiteralElementLike): boolean =>
        ts.isMethodDeclaration(property) ||
        (ts.isPropertyAssignment(property) &&
            (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer)));

    const walkFunction = (fn: Walkable, only: ReadonlySet<string> | undefined): void => {
        const key = `${site(fn)}#${only === undefined ? '*' : [...only].sort().join(',')}`;

        if (walked.has(key) || fn.body === undefined) {
            return;
        }

        walked.add(key);

        const body = fn.body;

        if (only === undefined || !ts.isBlock(body)) {
            visit(body);

            return;
        }

        for (const statement of body.statements) {
            if (
                ts.isReturnStatement(statement) &&
                statement.expression !== undefined &&
                ts.isObjectLiteralExpression(statement.expression)
            ) {
                for (const property of statement.expression.properties) {
                    if (
                        !isFunctionValued(property) ||
                        (property.name !== undefined && only.has(property.name.getText()))
                    ) {
                        visit(property);
                    }
                }
            } else {
                visit(statement);
            }
        }
    };

    const visit = (node: ts.Node): void => {
        // An import names a function without calling it, and a type runs nothing; walking either would undo the
        // narrowing below by entering a factory whole.
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) {
            return;
        }

        if (ts.isNewExpression(node)) {
            recordCommand(node);
        }

        if (ts.isCallExpression(node)) {
            const callee = resolveFunction(node.expression);

            if (callee !== undefined) {
                walkFunction(callee, namesOf(checker.getContextualType(node)));
            }

            node.arguments.forEach(visit);

            // The callee's NAME is the call above, not a reference to walk again; only what it is reached through is.
            if (ts.isPropertyAccessExpression(node.expression)) {
                visit(node.expression.expression);
            } else if (!ts.isIdentifier(node.expression)) {
                visit(node.expression);
            }

            return;
        }

        if (ts.isIdentifier(node)) {
            const referenced = resolveFunction(node);

            if (referenced !== undefined) {
                walkFunction(referenced, undefined);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(entry);

    return [...found.values()].sort((a, b) => a.action.localeCompare(b.action));
}

/**
 * A program over `rootNames`, compiled with `packages/infra/global/tsconfig.json`'s options.
 *
 * @param packageDir - `packages/infra/global`, absolute.
 * @param rootNames - The entry modules.
 * @param virtualFiles - Extra in-memory files by absolute path (the fixture table's), read before the disk.
 * @returns The program.
 * @sideEffect Reads the tsconfig and every module the roots import.
 */
export function packageProgram(
    packageDir: string,
    rootNames: readonly string[],
    virtualFiles: Readonly<Record<string, string>> = {},
): ts.Program {
    const parsed = ts.getParsedCommandLineOfConfigFile(
        path.join(packageDir, 'tsconfig.json'),
        {},
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
            },
        },
    );

    if (parsed === undefined) {
        throw new Error(`could not read ${packageDir}/tsconfig.json`);
    }

    const options = { ...parsed.options, noEmit: true };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    const exists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);

    host.readFile = (file) => virtualFiles[file] ?? read(file);
    host.fileExists = (file) => file in virtualFiles || exists(file);
    // Module resolution asks whether a directory exists before it looks inside it, and the fixtures' does not.
    host.directoryExists = (directory) =>
        Object.keys(virtualFiles).some((file) => file.startsWith(`${directory}/`)) || ts.sys.directoryExists(directory);

    host.getSourceFile = (file, language, onError, shouldCreate) => {
        const text = virtualFiles[file];

        return text === undefined
            ? getSourceFile(file, language, onError, shouldCreate)
            : ts.createSourceFile(file, text, language, true);
    };

    return ts.createProgram([...rootNames], options, host);
}
