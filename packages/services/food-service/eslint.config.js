import { createConfig, restrictedImportsRule } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

/**
 * The shared `no-restricted-syntax` selectors (the `sql.raw` ban among them), read out of the base config's unscoped
 * block rather than restated, the way `@kitchensink/eslint`'s `rawSqlBan.test.js` reads them.
 *
 * A later block's entry for this rule replaces the earlier one, so a block that adds a selector must carry these
 * forward or switch them off for its files.
 *
 * @returns {unknown[]} The selector objects, without the severity.
 */
function sharedRestrictedSyntax() {
    const general = base.find(
        (block) => block.files === undefined && block.rules?.['no-restricted-syntax'] !== undefined,
    );

    if (general === undefined) {
        throw new Error('the shared config no longer defines an unscoped no-restricted-syntax block');
    }

    const [, ...selectors] = general.rules['no-restricted-syntax'];

    return selectors;
}

/**
 * The catalog verifier's fence (curated catalog plan KTD-3, U6): its production modules import the archive reader and
 * nothing else of ours.
 *
 * The verifier is an N-version check of the seeder. It proves the catalog equals the committed bytes by reading those
 * bytes itself, in SQL, so any import of the seeder's interpretation (its format module, conversions, citation rules,
 * names, the bulk parser, or the schema) would let one shared mistake pass on both sides. The archive reader is the
 * exception because its public surface is checksum checks and byte streams.
 *
 * `regex`, not the gitignore `group` form: `ignore` will not un-ignore a path whose parent is ignored, which is the
 * position `../archive/` would hold under `../**`. Tests and fixtures are outside the fence, because a parity test
 * imports the seeder function it holds the verifier's SQL to. Composed through {@link restrictedImportsRule}, so the
 * shared package-internals allow-list stays in force here. A dynamic `import()` is banned by a syntax selector composed
 * after {@link sharedRestrictedSyntax}, so the shared syntax bans stay in force too (`restrictedImportsOverride.test.ts`
 * proves each).
 */
const verifierFence = {
    files: ['src/foods/seed/verify/**/*.ts'],
    ignores: ['src/foods/seed/verify/**/__tests__/**', 'src/foods/seed/verify/**/__fixtures__/**'],
    rules: {
        'no-restricted-imports': restrictedImportsRule(
            [],
            [
                {
                    regex: '^\\.\\./(?!archive/usdaSourceArchive\\.js$)',
                    message:
                        'The catalog verifier may import only the archive reader (../archive/usdaSourceArchive.js): it must stay independent of the seeder (curated catalog plan KTD-3).',
                },
                {
                    regex: '^@kitchensink/',
                    message:
                        'The catalog verifier imports no workspace package: it must stay independent of the seeder and the schema (curated catalog plan KTD-3).',
                },
            ],
        ),
        // The import rule reads declarations only, so a dynamic `import()` would pass the fence unreported.
        'no-restricted-syntax': [
            'error',
            ...sharedRestrictedSyntax(),
            {
                selector: 'ImportExpression',
                message:
                    'The catalog verifier may not use a dynamic import(): the import fence cannot see one. Import the archive reader statically (curated catalog plan KTD-3).',
            },
        ],
    },
};

export default [
    ...base,
    { ignores: ['dist/**'] },
    verifierFence,
    {
        // CDK infra is a SEPARATE tsconfig project, so type-aware lint needs the parser pointed at it — the same
        // block `@commise/web` already carries. Without it every `infra/**` file is a FATAL parse error ("not
        // found in any of the provided project(s)"): a file ESLint opens and runs no rule on, which is worse than
        // not linting it, because the file still appears in a passing run. The previous workaround was
        // `ignores: ['infra/**']`, which hid the CDK code that provisions production from the entire config —
        // including the `sql.raw` ban and the bracket-notation env rule.
        files: ['infra/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './infra/tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
