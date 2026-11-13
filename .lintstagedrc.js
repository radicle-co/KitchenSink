export default {
    // Prettier formats every supported file type.
    '*.{ts,tsx,js,jsx,json,md,css,html,yaml,yml}': ['prettier --write'],
    // oxlint: a fast (~ms) correctness lint on staged JS/TS at commit time (config in .oxlintrc.json).
    // ESLint (type-aware, thorough) intentionally stays in CI + editor integration — it is NOT run here.
    '*.{ts,tsx,js,jsx,cjs,mjs}': ['oxlint'],
    // Typecheck what the staged and edited files affect, their dependents included (ADR-0091). The arrow form ignores
    // the staged-file list on purpose: the selector reads the change from git, so it sees the graph, not only the list.
    '*.{ts,tsx}': () => 'npm run -s scope -- run typecheck --base=HEAD',
};
