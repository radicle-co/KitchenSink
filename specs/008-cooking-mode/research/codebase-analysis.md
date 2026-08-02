# Codebase Analysis: Cooking Mode

**Branch**: `008-cooking-mode` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [tasks.md](../tasks.md), root `package.json`, `AGENTS.md`

---

## Monorepo Layout Fit

KitchenSink is an npm workspaces + Turborepo monorepo. Root `package.json` currently defines:

```json
"workspaces": [
    "packages/tools/*",
    "packages/services/*",
    "packages/shared/*",
    "packages/utils/*",
    "packages/infra/*",
    "packages/apps/commise/web",
    "packages/apps/commise/mobile",
    "packages/apps/commise/ui",
    "packages/apps/commise/i18n",
    "packages/apps/commise/features/*",
    "packages/clients/*"
]
```

For feature 008, planned implementation spans existing workspaces only:

- `packages/apps/commise/web`
- `packages/apps/commise/mobile`
- `packages/shared/cooking/src/` (as referenced in plan/tasks)

---

## Build/Test/Lint Surfaces

Root scripts (from `package.json`):

- `npm run build` → `turbo run build`
- `npm run test` → `turbo run test`
- `npm run lint` → `turbo run lint format:check`
- `npm run typecheck` → `turbo run typecheck`

These commands already cover all affected workspaces once cooking-mode files are added.

---

## Planned Source Areas for 008

From `tasks.md`, expected file families include:

- Shared logic: `packages/shared/cooking/src/` (types, session store, timer service, wake lock adapters)
- Web UI: `packages/apps/commise/web/src/features/cooking-mode/`
- Mobile UI: `packages/apps/commise/mobile/src/features/cooking-mode/`

Current status in this bootstrap pass: these implementation paths are design targets only; no feature code is required/added.

---

## Dependency & Platform Considerations

1. **Wake lock**
    - Web: `navigator.wakeLock` API (with fallback).
    - Mobile: `expo-keep-awake`.

2. **Persistence abstraction**
    - Web: IndexedDB (or equivalent adapter).
    - Mobile: AsyncStorage.

3. **Voice control (Phase 2)**
    - Web Speech API and RN-native options are candidate integrations requiring feature-flagged rollout.

4. **Authentication and recipe source dependencies**
    - Feature consumes 001 recipe instructions and depends on 002 auth.

---

## Gaps / Warnings (Non-blocking for bootstrap)

- `packages/shared/cooking/src/` is specified in plan/tasks but may not yet exist in repository structure.
- Voice command framework choice is unresolved in plan open questions.
- Ingredient checkoff and cook-time scaling are requested domain additions but absent from canonical FR list.

---

## Conclusion

Feature 008 fits the existing monorepo architecture with no workspace topology changes required for bootstrap. Implementation can proceed using established web/mobile/shared package boundaries and root turbo scripts once revalidation confirms final scope.
