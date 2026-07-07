# KitchenSink

A TypeScript monorepo for the Commise platform — recipe management, meal planning, and kitchen organization across web and mobile.

## Prerequisites

- **Node.js** `>=24.0.0` (see `.nvmrc`)
- **npm** (ships with Node)

## Getting Started

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run all tests
npm run test

# Lint all packages
npm run lint

# Type check all packages
npm run typecheck

# Format all files
npm run format
```

## Monorepo Structure

| Workspace                        | Package                                                              | Description                  |
| -------------------------------- | -------------------------------------------------------------------- | ---------------------------- |
| `packages/apps/commise/web`    | `@commise/web`                                                   | Next.js web app              |
| `packages/apps/commise/mobile` | `@commise/mobile`                                                | Expo/React Native mobile app |
| `packages/ui`                    | `@commise/shared-ui`                                                    | Shared UI component library  |
| `packages/tools/*`               | `@commise/tools-eslint`, `typescript`, `vitest`, `prettier`, `esbuild` | Shared tooling configs       |

Root scripts delegate to [Turborepo](https://turbo.build/repo), which runs the matching script in each workspace.

## Documentation

- [AGENTS.md](AGENTS.md) — Agent context and architecture reference
- [CONTRIBUTING.md](CONTRIBUTING.md) — Development workflow and contribution guide
- [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) — Coding standards and conventions
- [docs/tooling.md](docs/tooling.md) — Tooling workspaces reference
