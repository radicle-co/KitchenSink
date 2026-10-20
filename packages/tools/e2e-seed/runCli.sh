#!/usr/bin/env bash
# The ONE door the seed and pool CLIs are run through, on a developer's machine and on a Maestro runner alike.
#
#   bash packages/tools/e2e-seed/runCli.sh <source.ts> [args...]
#   bash packages/tools/e2e-seed/runCli.sh verify <bundle dir> <commit>
#
# RUN. The command names the CLI's SOURCE (`packages/tools/e2e-seed/src/resetPool.ts`), never a bundle file, so every
# guard that finds a workflow step by what it runs still finds it.
#
#   - `E2E_SEED_CLI_DIR` unset or empty: `npx --no-install tsx <source>`, the dev path. `--no-install`, because without
#     the install `npx` would DOWNLOAD tsx and then fail on the first import, far from the cause.
#   - `E2E_SEED_CLI_DIR` set (a Maestro shard, after `verify`): the bundle `cliBundle.mjs` built for that source, run
#     with plain `node`. A source the manifest does not list, or a listed file that is missing, is REFUSED and never
#     falls back to tsx: a shard has no `node_modules`, so the fallback could only fail somewhere that names nothing.
#
#   ⛔ The bundle runs by its PHYSICAL path (`pwd -P`). `resetPool` and `poolAdmin` run `main()` only when
#   `import.meta.url` equals `argv[1]`, and Node resolves the first through symlinks but not the second, so a bundle
#   reached through a symlinked directory would load, skip `main()` and exit 0 — a reset that reset nothing.
#
# VERIFY. The bundles are this run's and whole: the manifest's commit equals <commit> (the job's own `GITHUB_SHA`) and
# every file it lists is present. A Maestro job runs it once, before it exports `E2E_SEED_CLI_DIR`.
#
# Held by `packages/tools/repoGuards/__tests__/seedCliLauncher.test.ts`; the bundles by
# `packages/tools/e2e-seed/tests/cliBundle.integration.test.ts`. Bash 3.2-safe (macOS's system bash).
set -euo pipefail

SEED_CLI_MANIFEST=seedCli.manifest

seed_cli_die() {
    echo "::error::e2e-seed runCli: $*" >&2
    exit 2
}

# seed_cli_manifest <dir> — the manifest's path, or a refusal.
seed_cli_manifest() {
    local manifest="$1/${SEED_CLI_MANIFEST}"

    [ -f "$manifest" ] || seed_cli_die "no ${SEED_CLI_MANIFEST} in '$1' — the seed CLI bundles were not downloaded there"
    printf '%s\n' "$manifest"
}

# seed_cli_verify <dir> <commit>
seed_cli_verify() {
    local dir="${1:-}" expected="${2:-}" manifest built missing=0 count=0 kind source file

    [ -n "$dir" ] || seed_cli_die 'verify needs the bundle directory'
    [ -n "$expected" ] || seed_cli_die 'verify needs the commit this job checked out (GITHUB_SHA is empty)'
    manifest=$(seed_cli_manifest "$dir")
    built=$(sed -n 's/^commit //p' "$manifest" | head -n 1)

    if [ "$built" != "$expected" ]; then
        seed_cli_die "the seed CLI bundles were built from '${built}', but this job checked out '${expected}' — refusing to seed with another commit's code"
    fi

    while read -r kind source file; do
        [ "$kind" = entry ] || continue
        count=$((count + 1))

        if [ ! -f "${dir}/${file}" ]; then
            echo "::error::e2e-seed runCli: the manifest lists ${file} (${source}) but it is not in ${dir}" >&2
            missing=1
        fi
    done <"$manifest"

    [ "$count" -gt 0 ] || seed_cli_die "${manifest} lists no bundle"
    [ "$missing" -eq 0 ] || exit 2
    echo "e2e-seed runCli: ${count} seed CLI bundle(s) built from ${built}, all present in ${dir}"
}

# seed_cli_run <source> [args...]
seed_cli_run() {
    local source="${1:-}" dir="${E2E_SEED_CLI_DIR:-}" manifest physical file

    [ -n "$source" ] || seed_cli_die 'usage: runCli.sh <source.ts> [args...] | runCli.sh verify <dir> <commit>'
    shift

    if [ -z "$dir" ]; then
        exec npx --no-install tsx "$source" "$@"
    fi

    manifest=$(seed_cli_manifest "$dir")
    # Exact field match on the source: a prefix or suffix of a listed source is a different CLI.
    file=$(awk -v source="$source" '$1 == "entry" && $2 == source { print $3; exit }' "$manifest")
    [ -n "$file" ] || seed_cli_die "${source} is not one of the bundled seed CLIs (${manifest}) — add it to cliBundle.mjs's SEED_CLIS"
    physical=$(cd "$dir" && pwd -P)
    [ -f "${physical}/${file}" ] || seed_cli_die "the manifest maps ${source} to ${file}, which is not in ${physical}"

    exec node --enable-source-maps "${physical}/${file}" "$@"
}

case "${1:-}" in
    verify)
        shift
        seed_cli_verify "$@"
        ;;
    *) seed_cli_run "$@" ;;
esac
