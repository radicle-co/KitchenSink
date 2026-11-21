#!/usr/bin/env bash
# The iOS test app for local lanes, built ON the Mac by the repo's own `buildTestApp.sh ios`, baked with loopback
# origins (localhost:13000-13002; the Mac's own port 3000 belongs to Docker) and the sandbox publishable key.
#
#   buildIosApp.sh content-key       print the key this tree + these origins resolve to (computed here, where git is)
#   buildIosApp.sh check <key> <app folder>   exit 0 only if the Mac holds an app for <key> whose manifest matches EXACTLY
#   buildIosApp.sh build <key> <app folder>   upload a snapshot to the Mac, build it there (one build at a time), keep the
#                                             app in <app folder>; the job is iosBuildJob.sh (CL-MACLOCK)
#
# A stale app is never driven: `check` runs `buildTestApp.sh verify-manifest` over the Mac's manifest, so a missing,
# different or extra field is a refusal. The key is computed on THIS machine and handed to the build (as CI does), so the
# manifest records the key the plan resolved and the Mac needs no git history.
#   KS_MAC_HOST, KS_MAC_SSH_CONFIG   as for xcrunShim.sh
#   CLERK_PUBLISHABLE_KEY            the sandbox Clerk publishable key (pk_test_…); public by design
#   KS_REPO_ROOT                     the tree to build (default: this script's repository)
#   KS_MAC_POLL_SECONDS              seconds between looks at the Mac job (default 20)
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

# The app's folder on the Mac, relative to its HOME, is stated by the caller (`macPathsOf().iosApp(key)`): this script builds
# no Mac path of its own. It becomes part of a remote command, so it is plain words and slashes, never absolute or `..`.
app_folder() {
    local folder="${1:-}"
    [[ "$folder" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] && [[ "/$folder/" != *"/../"* ]] ||
        die "the app folder '$folder' is not a relative path of plain names"
    printf '%s' "$folder"
}

# The Info.plist key buildTestApp.sh bakes the content key under (test_app_bake_content_key).
BAKED_KEY_NAME=KSTestAppContentKey

# The script the Mac runs to read the baked key: exactly one .app, a verifying signature, then the key. It answers on
# stdout (`BAKED:<key>` or `FAIL:<reason>`) and always exits 0, so a refusal is told apart from a lost ssh link.
baked_key_probe() {
    printf "app='%s'; key_name='%s'; export PATH='%s'\n" "$1" "$BAKED_KEY_NAME" "$MAC_PATH"
    cat <<'PROBE'
cd "$HOME/$app" 2>/dev/null || { echo FAIL:folder; exit 0; }
bundles="$(find . -maxdepth 1 -name '*.app' -type d)"
[ -n "$bundles" ] || { echo FAIL:noapp; exit 0; }
[ "$(printf '%s\n' "$bundles" | wc -l | tr -d ' ')" = 1 ] || { echo FAIL:manyapps; exit 0; }
codesign --verify --strict "$bundles" >/dev/null 2>&1 || { echo FAIL:seal; exit 0; }
baked="$(plutil -extract "$key_name" raw -o - "$bundles/Info.plist" 2>/dev/null)" || { echo FAIL:nokey; exit 0; }
echo "BAKED:$baked"
PROBE
}

command_name="${1:-}"
case "$command_name" in
    content-key)
        bash "$BUILD_SCRIPT" content-key ios
        ;;
    check)
        key="${2:?check needs a content key}"
        [[ "$key" =~ ^[0-9a-f]+$ ]] || die "'$key' is not a content key"
        app="$(app_folder "${3:-}")"
        manifest="$(mktemp)"
        trap 'rm -f "$manifest"' EXIT
        mac "cat $app/testApp.manifest" >"$manifest" 2>/dev/null ||
            die "no test app for key $key on the Mac. Build it: buildIosApp.sh build $key $app"
        EXPECT_CONTENT_KEY="$key" \
            EXPECT_RECIPE_ORIGIN="$EXPO_PUBLIC_RECIPE_API_URL" \
            EXPECT_FOOD_ORIGIN="$EXPO_PUBLIC_FOOD_API_URL" \
            EXPECT_IDENTITY_ORIGIN="$EXPO_PUBLIC_IDENTITY_API_URL" \
            EXPECT_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" \
            EXPECT_XCODE_VERSION="$(mac "DEVELOPER_DIR=$MAC_DEVELOPER_DIR xcodebuild -version" | tr '\n' ' ' | sed 's/ *$//')" \
            bash "$BUILD_SCRIPT" verify-manifest "$manifest" ios ||
            die "the app on the Mac for key $key does not match this tree. Rebuild: buildIosApp.sh build $key $app"
        # The manifest is a plain file anyone can rewrite. The key the build baked into the app's own Info.plist is
        # sealed by the app's code signature, so a rewritten manifest over another build's app is refused here. The
        # limit: anyone can re-sign an app ad hoc, so this stops a careless copy or edit, not a deliberate forgery.
        rebuild="Rebuild: buildIosApp.sh build $key $app"
        result="$(mac "$(baked_key_probe "$app")")" || die "could not read the app on the Mac for key $key"
        case "$result" in
            "BAKED:$key") ;;
            BAKED:*) die "the app on the Mac was baked for key ${result#BAKED:}, not $key. $rebuild" ;;
            FAIL:folder) die "no app folder $app on the Mac. $rebuild" ;;
            FAIL:noapp) die "the app folder $app holds no .app. $rebuild" ;;
            FAIL:manyapps) die "the app folder $app holds more than one .app. $rebuild" ;;
            FAIL:seal) die "the app's code signature does not verify (edited after the build). $rebuild" ;;
            FAIL:nokey) die "the app has no $BAKED_KEY_NAME in its Info.plist (built before the bake). $rebuild" ;;
            *) die "unexpected answer from the Mac: $result" ;;
        esac
        echo "$app is current"
        ;;
    build)
        key="${2:?build needs a content key}"
        [[ "$key" =~ ^[0-9a-f]+$ ]] || die "'$key' is not a content key"
        app="$(app_folder "${3:-}")"
        sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
        poll_seconds="${KS_MAC_POLL_SECONDS:-20}"
        [[ "$poll_seconds" =~ ^[0-9]+$ ]] || die "KS_MAC_POLL_SECONDS must be a whole number"

        # One job, one folder: nothing it writes is shared with another job, or with an old copy of this script.
        host_part="$(hostname -s | tr -c 'A-Za-z0-9' '-' | cut -c1-20)"
        job="$(date -u +%Y%m%dT%H%M%SZ)-${host_part}-$$"
        jobs="ksIos/build.noindex/jobs"
        mac "mkdir -p $jobs/$job/src $(dirname "$app")"
        # The files git knows (tracked, and untracked but not ignored), and no others: a secret in an ignored file never
        # leaves this machine, and nothing the build writes (node_modules, dist) is sent. A tracked file deleted from the
        # tree is skipped, not an error. Dependencies are installed on the Mac (their native parts are arm64 macOS).
        git -C "$REPO_ROOT" ls-files -z --cached --others --exclude-standard |
            rsync -a --from0 --files-from=- --ignore-missing-args -e "ssh -F $KS_MAC_SSH_CONFIG" \
                --exclude '/.worktrees/' \
                "$REPO_ROOT/" "$KS_MAC_HOST:$jobs/$job/src/"

        # The build runs DETACHED on the Mac and this side polls: a Release build outlasts any ssh link on a loaded Mac
        # (the first real attempt lost its connection mid-compile and the build died with it). The job script is the
        # snapshot's own, so it always matches the source it builds. The result is written whole (`mv`), never half.
        job_dir="$jobs/$job"
        node_word=''
        [ -z "$MAC_NODE_BIN" ] || node_word="KS_NODE_BIN=$MAC_NODE_BIN"
        env_words="PATH=$MAC_PATH DEVELOPER_DIR=$MAC_DEVELOPER_DIR GITHUB_SHA=$sha $node_word"
        env_words="$env_words EXPO_PUBLIC_RECIPE_API_URL=$EXPO_PUBLIC_RECIPE_API_URL EXPO_PUBLIC_IDENTITY_API_URL=$EXPO_PUBLIC_IDENTITY_API_URL"
        env_words="$env_words EXPO_PUBLIC_FOOD_API_URL=$EXPO_PUBLIC_FOOD_API_URL EXPO_PUBLIC_IDP_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY"
        run_job="env $env_words bash $job_dir/src/packages/tools/local-sandbox/bin/mac/iosBuildJob.sh $job $key $app > $job_dir/build.log 2>&1"
        mac "nohup sh -c '$run_job; echo \$? > $job_dir/build.rc.tmp; mv $job_dir/build.rc.tmp $job_dir/build.rc' > /dev/null 2>&1 &"

        # One round trip a poll. The result first. Then the phase, and whether the wrapper that should write the result is
        # gone: its pid dead, or the Mac rebooted since (the pid may then belong to something else).
        # shellcheck disable=SC2016 # the variables are the Mac's
        poll_command='cd @JOB_DIR@ 2>/dev/null || { echo GONE; exit 0; }
if [ -f build.rc ]; then echo "RC $(cat build.rc)"; exit 0; fi
echo "STATE $(cat state 2>/dev/null)"
if [ -f wrapper ]; then
    read -r pid boot < wrapper
    now=$( (sysctl -n kern.boottime 2>/dev/null || cat /proc/sys/kernel/random/boot_id) | tr " \n" "__")
    if ! kill -0 "$pid" 2>/dev/null || [ "$boot" != "$now" ]; then echo DEAD; fi
fi'
        poll_command="${poll_command//@JOB_DIR@/$job_dir}"
        last_state=''
        dead=0
        while :; do
            if ! answer="$(mac "$poll_command" 2>/dev/null)"; then
                sleep "$poll_seconds"
                continue
            fi
            case "$answer" in
                GONE) die "the job folder $job_dir is gone from the Mac (job $job)" ;;
                RC*)
                    rc="${answer#RC }"
                    break
                    ;;
            esac
            state="$(printf '%s\n' "$answer" | sed -n 's/^STATE //p')"
            if [ -n "$state" ] && [ "$state" != "$last_state" ]; then
                echo "buildIosApp: $state" >&2
                last_state="$state"
            fi
            # A wrapper that just ended writes its result a moment later: look twice before saying it died.
            if printf '%s\n' "$answer" | grep -qx DEAD; then
                dead=$((dead + 1))
                [ "$dead" -lt 2 ] || die "the build wrapper for job $job is gone and left no result; see $job_dir/build.log on the Mac"
            else
                dead=0
            fi
            sleep "$poll_seconds"
        done

        case "$rc" in
            0)
                "$0" check "$key" "$app"
                mac "rm -rf $job_dir"
                ;;
            75)
                holder="$(mac 'cat ksIos/build.noindex/build.owner' 2>/dev/null || echo 'holder unknown')"
                die "the Mac build lock is held ($holder), job $job gave up waiting"
                ;;
            *)
                mac "tail -60 $job_dir/build.log" >&2 || true
                die "the Mac build failed (exit $rc), job $job; log: $job_dir/build.log on the Mac"
                ;;
        esac
        ;;
    *)
        die 'usage: buildIosApp.sh content-key | check <key> <app folder> | build <key> <app folder>'
        ;;
esac
