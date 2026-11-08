#!/usr/bin/env bash
# The iOS test app for local lanes, built ON the Mac by the repo's own `buildTestApp.sh ios`, baked with loopback
# origins (localhost:13000-13002; the Mac's own port 3000 belongs to Docker) and the sandbox publishable key.
#
#   buildIosApp.sh content-key       print the key this tree + these origins resolve to (computed here, where git is)
#   buildIosApp.sh check <key>       exit 0 only if the Mac holds an app for <key> whose manifest matches EXACTLY
#   buildIosApp.sh build <key>       sync the source to the Mac, build there, keep it under ksIos/apps/<key>
#
# A stale app is never driven: `check` runs `buildTestApp.sh verify-manifest` over the Mac's manifest, so a missing,
# different or extra field is a refusal. The key is computed on THIS machine and handed to the build (as CI does), so the
# manifest records the key the plan resolved and the Mac needs no git history.
#   KS_MAC_HOST, KS_MAC_SSH_CONFIG   as for xcrunShim.sh
#   CLERK_PUBLISHABLE_KEY            the sandbox Clerk publishable key (pk_test_…); public by design
#   KS_REPO_ROOT                     the tree to build (default: this script's repository)
set -euo pipefail

# The build folder ends in .noindex so Spotlight skips it: indexing a node_modules tree and derived data held the Mac at
# load 20+ and made the lane planner see no free cpu.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${KS_REPO_ROOT:-$(cd "$HERE/../../../../.." && pwd)}"
BUILD_SCRIPT="$REPO_ROOT/packages/apps/commise/mobile/scripts/buildTestApp.sh"

: "${KS_MAC_HOST:?KS_MAC_HOST is not set; the Mac to drive is never guessed}"
: "${KS_MAC_SSH_CONFIG:?KS_MAC_SSH_CONFIG is not set}"
# Xcode is taken from the Mac's own selection, but the key must hash a fixed string, so it is pinned here.
MAC_DEVELOPER_DIR="${KS_MAC_DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
MAC_PATH="${KS_MAC_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
MAC_NODE_BIN="${KS_MAC_NODE_BIN:-}" # a node 24 bin folder on the Mac; resolved from ~/.nvm when empty

die() {
    echo "buildIosApp: $*" >&2
    exit 1
}

mac() {
    ssh -F "$KS_MAC_SSH_CONFIG" "$KS_MAC_HOST" "$@"
}

# Values below are written inside quotes into a script the Mac runs, and `rsync -e` splits its own string, so each must be
# plain: a quote, space or metacharacter is refused here instead of being escaped in four places.
plain() {
    local name="$1" value="$2" pattern="$3"
    [[ "$value" =~ $pattern ]] || die "$name holds a character that is not allowed in it (quote, space or metacharacter)"
}
plain KS_MAC_SSH_CONFIG "$KS_MAC_SSH_CONFIG" '^[A-Za-z0-9._/@%+=:,-]+$'
plain KS_MAC_DEVELOPER_DIR "$MAC_DEVELOPER_DIR" '^[A-Za-z0-9._/@%+=:,-]+$'
plain KS_MAC_PATH "$MAC_PATH" '^[A-Za-z0-9._/@%+=:,-]+$'

case "${CLERK_PUBLISHABLE_KEY:-}" in
    pk_test_*) ;;
    *) die 'CLERK_PUBLISHABLE_KEY must be the test publishable key (pk_test_…)' ;;
esac
plain CLERK_PUBLISHABLE_KEY "$CLERK_PUBLISHABLE_KEY" '^pk_test_[A-Za-z0-9+/=_-]+$'

# The Mac port the recipe service is tunnelled to is one fact, stated in localMaestro.sh's settings.
MAC_RECIPE_PORT="$(bash -c '. "$1" && printf %s "$LOCAL_MAESTRO_MAC_RECIPE_PORT"' _ "$HERE/../localMaestro.sh")"
[[ "$MAC_RECIPE_PORT" =~ ^[0-9]+$ ]] || die "localMaestro.sh did not state LOCAL_MAESTRO_MAC_RECIPE_PORT"
export EXPO_PUBLIC_RECIPE_API_URL="http://localhost:${MAC_RECIPE_PORT}"
export EXPO_PUBLIC_IDENTITY_API_URL='http://localhost:13001'
export EXPO_PUBLIC_FOOD_API_URL='http://localhost:13002'
export EXPO_PUBLIC_IDP_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY"
export DEVELOPER_DIR="$MAC_DEVELOPER_DIR"

command_name="${1:-}"
case "$command_name" in
    content-key)
        bash "$BUILD_SCRIPT" content-key ios
        ;;
    check)
        key="${2:?check needs a content key}"
        [[ "$key" =~ ^[0-9a-f]+$ ]] || die "'$key' is not a content key"
        manifest="$(mktemp)"
        trap 'rm -f "$manifest"' EXIT
        mac "cat ksIos/apps/$key/testApp.manifest" >"$manifest" 2>/dev/null ||
            die "no test app for key $key on the Mac. Build it: buildIosApp.sh build $key"
        EXPECT_CONTENT_KEY="$key" \
            EXPECT_RECIPE_ORIGIN="$EXPO_PUBLIC_RECIPE_API_URL" \
            EXPECT_FOOD_ORIGIN="$EXPO_PUBLIC_FOOD_API_URL" \
            EXPECT_IDENTITY_ORIGIN="$EXPO_PUBLIC_IDENTITY_API_URL" \
            EXPECT_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" \
            EXPECT_XCODE_VERSION="$(mac "DEVELOPER_DIR=$MAC_DEVELOPER_DIR xcodebuild -version" | tr '\n' ' ' | sed 's/ *$//')" \
            bash "$BUILD_SCRIPT" verify-manifest "$manifest" ios ||
            die "the app on the Mac for key $key does not match this tree. Rebuild: buildIosApp.sh build $key"
        echo "ksIos/apps/$key is current"
        ;;
    build)
        key="${2:?build needs a content key}"
        [[ "$key" =~ ^[0-9a-f]+$ ]] || die "'$key' is not a content key"
        sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
        mac 'mkdir -p ksIos/build.noindex/src ksIos/apps'
        # The source only: dependencies are installed on the Mac (their native parts are arm64 macOS), and generated
        # folders are rebuilt there.
        rsync -a --delete -e "ssh -F $KS_MAC_SSH_CONFIG" \
            --exclude node_modules --exclude .git --exclude .worktrees --exclude .turbo \
            --exclude 'dist*' --exclude '/packages/apps/commise/mobile/ios' --exclude '/packages/apps/commise/mobile/android' \
            "$REPO_ROOT/" "$KS_MAC_HOST:ksIos/build.noindex/src/"
        # `npm ci` only when the lockfile changed since the last install here.
        lock_sha="$(sha256sum "$REPO_ROOT/package-lock.json" | cut -d' ' -f1)"
        # The build runs DETACHED on the Mac and this side polls: a Release build outlasts any ssh link on a loaded Mac
        # (the first real attempt lost its connection mid-compile and the build died with it).
        # shellcheck disable=SC2016 # the variables are the Mac's
        mac 'cat > ksIos/build.noindex/build.sh' <<REMOTE
set -e
export PATH="\${KS_NODE_BIN:-\$(ls -d \$HOME/.nvm/versions/node/v24*/bin | sort -V | tail -1)}:$MAC_PATH"
cd ksIos/build.noindex/src
if [ "\$(cat ../lock.sha 2>/dev/null)" != '$lock_sha' ] || [ ! -d node_modules ]; then rm -f ../lock.sha; npm ci; echo '$lock_sha' > ../lock.sha; fi
export DEVELOPER_DIR='$MAC_DEVELOPER_DIR' LANG=en_US.UTF-8
export EXPO_PUBLIC_RECIPE_API_URL='$EXPO_PUBLIC_RECIPE_API_URL' EXPO_PUBLIC_IDENTITY_API_URL='$EXPO_PUBLIC_IDENTITY_API_URL'
export EXPO_PUBLIC_FOOD_API_URL='$EXPO_PUBLIC_FOOD_API_URL' EXPO_PUBLIC_IDP_PUBLISHABLE_KEY='$CLERK_PUBLISHABLE_KEY'
export TEST_APP_CONTENT_KEY='$key' GITHUB_SHA='$sha' RUNNER_TEMP=\$HOME/ksIos/build.noindex/tmp
mkdir -p \$RUNNER_TEMP
npx turbo run build --filter='@commise/mobile^...'
bash packages/apps/commise/mobile/scripts/buildTestApp.sh ios
rm -rf \$HOME/ksIos/apps/$key && mkdir -p \$HOME/ksIos/apps/$key
cp packages/apps/commise/mobile/dist-testApp/ios/* \$HOME/ksIos/apps/$key/
tar -xzf \$HOME/ksIos/apps/$key/app.tar.gz -C \$HOME/ksIos/apps/$key
REMOTE
        mac 'rm -f ksIos/build.noindex/build.rc; nohup sh -c "bash ksIos/build.noindex/build.sh > ksIos/build.noindex/build.log 2>&1; echo \$? > ksIos/build.noindex/build.rc" > /dev/null 2>&1 &'
        until rc="$(mac 'cat ksIos/build.noindex/build.rc' 2>/dev/null)"; do sleep 20; done
        [ "$rc" = 0 ] || { mac 'tail -60 ksIos/build.noindex/build.log' >&2 || true; die "the Mac build failed (exit $rc); log: ksIos/build.noindex/build.log on the Mac"; }
        "$0" check "$key"
        ;;
    *)
        die 'usage: buildIosApp.sh content-key | check <key> | build <key>'
        ;;
esac
