/**
 * staff-code-quality — ADVISORY dependency-cruiser rules, used only when the target package has no
 * `.dependency-cruiser.*` of its own (a repository config always wins). Circularity is the one structural
 * smell every codebase should be clean of; orphans are reported as warnings because entry points,
 * generated files and framework-discovered modules legitimately have no importers.
 */
module.exports = {
    forbidden: [
        { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
        {
            name: 'no-orphans',
            severity: 'warn',
            from: {
                orphan: true,
                pathNot: ['\\.d\\.ts$', '(^|/)tsconfig\\.json$', '\\.(test|spec)\\.[jt]sx?$', '(^|/)(page|layout|route|index|main)\\.[jt]sx?$', '\\.config\\.[cm]?[jt]s$'],
            },
            to: {},
        },
    ],
    options: { tsPreCompilationDeps: true, doNotFollow: { path: 'node_modules' } },
};
