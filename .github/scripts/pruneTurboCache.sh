#!/usr/bin/env bash
#
# Delete the turbo cache archives that no run of THIS job used, so the entry the job saves holds only what it needs.
#
# ⛔ WHY. A job restores the newest cache entry of its family (`restore-keys`), turbo adds the archives for the hashes that
# changed, and the job saves the result under a new key. Nothing ever removed the archive of a hash that no later run asks
# for, so each entry carried every task output of every earlier commit and grew by a few tens of megabytes per push. The
# entries reached 0.7 to 1.3 GB (6.6 GB of the 10 GB repository cap) although a full build of the workspace archives about
# 40 MB. Pruning to the hashes this job used keeps each entry the size of one run's outputs.
#
# The hashes come from turbo's own run summaries (`TURBO_RUN_SUMMARY=true`, one JSON per `turbo run`): every task that ran
# or hit is listed with its hash, so the union over the job's runs is exactly what a repeat of this job would ask for.
#
# ⛔ NEVER DELETE WHEN IT CANNOT TELL. No summary, an unreadable one, or one naming no task is "I do not know what was used",
# which is not "nothing was used": acting on it would empty the cache the next run restores. Only files shaped like a turbo
# archive (`<16 hex>.tar.zst`, `<16 hex>-meta.json`) are ever candidates.
#
#   bash .github/scripts/pruneTurboCache.sh [<cacheDir> [<runsDir>]]     # defaults: .turbo/cache  .turbo/runs
#
# @sideEffect Deletes files under <cacheDir>.
set -euo pipefail

CACHE_DIR="${1-.turbo/cache}"
RUNS_DIR="${2-.turbo/runs}"

if [ ! -d "$CACHE_DIR" ]; then
    echo "[turbo-prune] no cache directory at ${CACHE_DIR}; nothing to prune"
    exit 0
fi

used="$(mktemp)"
trap 'rm -f "$used"' EXIT

shopt -s nullglob
for summary in "$RUNS_DIR"/*.json; do
    if ! jq -r '.tasks[]?.hash // empty' "$summary" >>"$used" 2>/dev/null; then
        echo "[turbo-prune] cannot read ${summary}; keeping the whole cache"
        exit 0
    fi
done

if [ ! -s "$used" ]; then
    echo "[turbo-prune] no run summary names a task; keeping the whole cache"
    exit 0
fi

kept=0
removed=0
for file in "$CACHE_DIR"/*; do
    name="$(basename "$file")"
    if [[ ! "$name" =~ ^([0-9a-f]{16})(\.tar\.zst|-meta\.json)$ ]]; then
        continue
    fi

    if grep -qxF "${BASH_REMATCH[1]}" "$used"; then
        kept=$((kept + 1))
    else
        rm -f "$file"
        removed=$((removed + 1))
    fi
done

echo "[turbo-prune] kept ${kept} file(s) this job used, removed ${removed} nothing asked for"
