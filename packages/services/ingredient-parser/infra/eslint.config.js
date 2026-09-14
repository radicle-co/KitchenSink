/**
 * ESLint for a CDK package that lives OUTSIDE the npm workspace.
 *
 * ⛔ Its presence is the whole point. `cdk-checks` runs `npx eslint .` in every directory it discovers and
 * swallows a non-zero exit into a `::warning::`, so a package with NO config does not fail — it reports
 * "couldn't find a configuration file" into a warning nobody reads, and its sources are silently unlinted
 * while the coverage guard still counts them as covered. That is exactly the shape §7.1 calls a tier CI
 * calls but cannot run.
 *
 * ⚠️ `@kitchensink/eslint` is deliberately NOT a dependency of this package. Declaring it would make npm
 * resolve a private workspace package from the registry and fail the install; undeclared, Node's upward walk
 * finds the workspace symlink the repo-root install has already created.
 */
import { createConfig } from '@kitchensink/eslint';

export default createConfig('./tsconfig.json', import.meta.dirname);
