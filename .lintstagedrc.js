export default {
    // Prettier formats every supported file type.
    '*.{ts,tsx,js,jsx,json,md,css,html,yaml,yml}': ['prettier --write'],
    // oxlint: a fast (~ms) correctness lint on staged JS/TS at commit time (config in .oxlintrc.json).
    // ESLint (type-aware, thorough) intentionally stays in CI + editor integration — it is NOT run here.
    '*.{ts,tsx,js,jsx,cjs,mjs}': ['oxlint'],
    // Whole-repo typecheck when any TS changes (the arrow form ignores the staged-file list on purpose).
    '*.{ts,tsx}': () => 'npx turbo run typecheck',
};
