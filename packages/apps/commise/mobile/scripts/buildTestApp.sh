#!/usr/bin/env bash
# THE ONE HOME OF HOW THE MOBILE TEST APP IS BUILT, and of how a built one is named and checked.
#
# "Test app" means the binary the deployed Maestro tier drives: a Release build for ONE platform, with the JS bundle
# embedded and `EXPO_PUBLIC_*` inlined, pointed at one stage's DEPLOYED origins. It is a test artifact and nothing
# else — the Android build is signed with the debug keystore and targets `x86_64` only (the CI emulator), the iOS build
# targets the Simulator SDK, and both talk to sandbox origins. A shipping build uses `eas.json`'s `production` profile,
# which no workflow runs today (owner, 2026-10-13).
#
# The recipe used to be inline in two jobs of `_ci-heavy.yml`, once per shard, so every shard paid for the build and the
# two copies could drift. It lives here instead; `_mobileAppBuild.yml` is the only caller that builds, and it builds
# each platform ONCE per run (and not at all when an artifact of the same content already exists).
#
# Usage (run from anywhere; the script resolves its own paths):
#
#     buildTestApp.sh android                        # build dist-testApp/android/{app.apk,testApp.manifest}
#     buildTestApp.sh ios                            # build dist-testApp/ios/{app.tar.gz,testApp.manifest}
#     buildTestApp.sh content-key <platform>         # print turbo's hash for `testApp:<platform>`
#     buildTestApp.sh write-manifest <platform> <file>
#     buildTestApp.sh verify-manifest <file> <platform>     # reads EXPECT_* from the environment; PURE
#     buildTestApp.sh artifact-name <platform> <key>        # the artifact a key is stored under
#     buildTestApp.sh key-from-artifact-name <platform> <name>   # …and its exact inverse
#     buildTestApp.sh xcode-version                         # `xcodebuild -version` on one line
#     buildTestApp.sh select-reusable <repositoryId> <name> # stdin: the artifacts API response; prints a run id, or nothing
#
# ## The content key (Memoization key — turbo's hash, no hasher of ours)
#
# `content-key` prints the `hash` of the `@commise/mobile#testApp:<platform>` task from `turbo run --dry=json` (and, on
# stderr, what was hashed — inputs and variable digests, never values — so a plan/build mismatch can be diffed). What that
# hash covers is declared in this package's `turbo.json` and asserted against turbo's resolved graph by
# `packages/infra/global/__tests__/testAppContentKey.test.ts`: the app's source, its whole dependency closure, this
# script, the workflow that runs it, and the VALUES of the origins, the publishable key and the cache epoch. An artifact
# is named `commise-test-app-<platform>-<key>`, and an artifact of that name is reused instead of rebuilt.
#
# The name convention lives HERE and nowhere else (`artifact-name` / `key-from-artifact-name`): the build workflow names
# an artifact with the first, a shard recovers the key it must hold the manifest to with the second, and two copies of a
# naming rule are how a rename on one side silently turns every reuse into a miss.
#
# ## The manifest (Specification — `verify-manifest` is pure)
#
# Each artifact carries `testApp.manifest`, exact `key=value` lines recording what it was built FROM. A shard holds a
# binary some other run may have built, so it REFUSES anything that is not exactly what this run resolved: a missing,
# unknown, duplicated or different field is a red job, never a green one. `builtFromSha` and `builtInRun` are provenance:
# required, never compared. `packages/infra/global/__tests__/buildTestAppManifest.test.ts` executes this file over a
# table of faults. ⚠️ Portable to bash 3.2 (the macOS runner's `/bin/bash`): no associative arrays, no `mapfile`.
set -euo pipefail

TEST_APP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_APP_MOBILE_DIR="$(cd "${TEST_APP_SCRIPT_DIR}/.." && pwd)"
TEST_APP_REPO_ROOT="$(cd "${TEST_APP_MOBILE_DIR}/../../../.." && pwd)"

# The ABIs the CI test APK contains. ONE, because the only consumer is the x86_64 emulator; building the other three cost
# 9.9 of the 18.4 minutes of the measured Android build (run 38322183404). A phone cannot run this APK, and that is the
# point: a shipping build is `eas.json`'s `production` profile.
TEST_APP_ANDROID_ABIS='x86_64'

# The secrets `load-secrets` puts in the job environment. NO SECRET REACHES A BUILD: Gradle and `xcodebuild` import the
# environment (xcodebuild even echoes it as build settings ahead of every script phase), GitHub masks the console and
# not a file, and the build needs none of them — the publishable key is public.
# `maestroIosTier.test.ts` derives this list from `load-secrets` itself.
TEST_APP_SECRET_VARIABLES='CLERK_SECRET_KEY IDP_SECRET_KEY CLERK_WEBHOOK_SECRET IDP_WEBHOOK_SECRET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN'

# The manifest keys, in the order they are written.
TEST_APP_COMMON_KEYS='platform contentKey recipeOrigin foodOrigin identityOrigin publishableKeySha256'
TEST_APP_PROVENANCE_KEYS='builtFromSha builtInRun'

test_app_die() {
    echo "::error::buildTestApp: $*" >&2
    exit 1
}

# test_app_check_platform <platform>
test_app_check_platform() {
    case "${1:-}" in
        android | ios) ;;
        *) test_app_die "'${1:-}' is not a test app platform — expected android or ios" ;;
    esac
}

# test_app_require_env <NAME>…  Refuses an unset OR empty variable.
test_app_require_env() {
    local name
    for name in "$@"; do
        [ -n "${!name:-}" ] || test_app_die "${name} is not set — refusing to guess"
    done
}

# test_app_sha256 <text>  The hex SHA-256 of the text's bytes, no trailing newline. The one digest in this file.
test_app_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$1" | sha256sum | cut -d' ' -f1
    else
        printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
    fi
}

# test_app_content_key <platform>
#
# Turbo's hash for the platform's task. Run from the repository root, with the hashed environment exported (the three
# origins, the publishable key, the epoch, and on iOS DEVELOPER_DIR). EMPTY OUTPUT IS AN ERROR: an empty key would name
# every build the same artifact.
test_app_content_key() {
    local platform="$1" plan key
    test_app_check_platform "$platform"
    command -v jq >/dev/null 2>&1 || test_app_die 'jq is required to read turbo’s plan'

    plan="$(cd "$TEST_APP_REPO_ROOT" && npx turbo run "testApp:${platform}" --filter=@commise/mobile --dry=json)" ||
        test_app_die "turbo could not plan testApp:${platform}"
    key="$(printf '%s' "$plan" | jq -r --arg id "@commise/mobile#testApp:${platform}" \
        '[.tasks[] | select(.taskId == $id) | .hash // empty] | first // empty')" ||
        test_app_die 'turbo’s plan was not JSON'

    [ -n "$key" ] || test_app_die "turbo emitted no hash for @commise/mobile#testApp:${platform}"
    test_app_explain_key "$platform" "$plan" "$key"
    printf '%s\n' "$key"
}

# test_app_explain_key <platform> <turbo plan JSON> <key>
#
# WHAT TURBO HASHED, on STDERR, so that when the plan job and a build job disagree about a key the two logs can be diffed
# down to the cause. Stdout stays the key alone. HASHES ONLY: every input file with the hash turbo reports for it, every
# declared environment variable by NAME with a short digest of its value (`(unset)` when it has none) — never a value.
# The origins and the publishable key are not secrets, but "hashes only" is a rule with no exceptions to argue about.
test_app_explain_key() {
    local platform="$1" plan="$2" key="$3" id="@commise/mobile#testApp:$1" name value

    {
        echo "::group::content key ${key} for testApp:${platform} (hashes only, never values)"
        echo "task hash ${key}"
        printf '%s' "$plan" | jq -r --arg id "$id" '
            ( [.tasks[] | select(.taskId == $id)][0] ) as $task
            | "external dependencies \($task.hashOfExternalDependencies // "(none)")",
              ( ($task.inputs // {}) | to_entries | sort_by(.key)[] | "input \(.key) \(.value)" ),
              ( (.globalCacheInputs.files // {}) | to_entries | sort_by(.key)[] | "global \(.key) \(.value)" )
        '
        for name in $(printf '%s' "$plan" | jq -r --arg id "$id" '[.tasks[] | select(.taskId == $id)][0].environmentVariables.specified.env // [] | sort[]'); do
            value="${!name:-}"
            if [ -n "$value" ]; then
                echo "env ${name} $(test_app_sha256 "$value" | cut -c1-16)"
            else
                echo "env ${name} (unset)"
            fi
        done
        echo '::endgroup::'
    } >&2
}

# test_app_artifact_name <platform> <key>
#
# `commise-test-app-<platform>-<key>`. The key must be lowercase hex: it becomes part of a name that is looked up, uploaded
# and downloaded, so nothing that could carry a path separator, whitespace or a second field is admitted.
test_app_artifact_name() {
    local platform="${1:-}" key="${2:-}"
    test_app_check_platform "$platform"
    [[ "$key" =~ ^[0-9a-f]+$ ]] || test_app_die "'${key}' is not a content key (lowercase hex) — refusing to name an artifact from it"
    printf 'commise-test-app-%s-%s\n' "$platform" "$key"
}

# test_app_key_from_artifact_name <platform> <name>   The exact inverse of test_app_artifact_name; anything else is refused.
test_app_key_from_artifact_name() {
    local platform="${1:-}" name="${2:-}"
    test_app_check_platform "$platform"
    [[ "$name" =~ ^commise-test-app-${platform}-([0-9a-f]+)$ ]] ||
        test_app_die "'${name}' is not a ${platform} test app artifact name (commise-test-app-${platform}-<key>)"
    printf '%s\n' "${BASH_REMATCH[1]}"
}

# test_app_xcode_version  `xcodebuild -version` is two lines; one line keeps a manifest pair on one line.
test_app_xcode_version() {
    printf '%s\n' "$(xcodebuild -version | tr '\n' ' ' | sed 's/ *$//')"
}

# test_app_select_reusable <repositoryId> <name>
#
# WHICH EARLIER BUILD MAY STAND IN FOR A NEW ONE. Reads the GitHub artifacts API response on stdin and prints the id of the
# run that produced the NEWEST artifact that is (a) named exactly <name>, (b) not expired, and (c) produced by a run of THIS
# repository — `workflow_run.repository_id` AND `workflow_run.head_repository_id` both equal <repositoryId>. Prints nothing
# when there is none.
#
# ⛔ (c) IS THE SECURITY RULE. A pull request from a FORK runs with the fork as its head repository, and an artifact it
# uploaded is code from outside this repository; accepting it would let a fork choose the binary every shard installs. A
# field that is absent is a field that did not match — every doubtful case is a refusal, because refusing only costs a
# rebuild. The repository id is validated as digits before it is passed to jq (`--argjson` parses it as JSON).
test_app_select_reusable() {
    local repository_id="${1:-}" name="${2:-}"
    [[ "$repository_id" =~ ^[0-9]+$ ]] || test_app_die "'${repository_id}' is not a repository id — refusing to select an artifact"
    [ -n "$name" ] || test_app_die 'select-reusable needs the artifact name'
    command -v jq >/dev/null 2>&1 || test_app_die 'jq is required to read the artifacts response'

    jq -r --argjson repository "$repository_id" --arg name "$name" '
        [ .artifacts[]?
          | select(.name == $name)
          | select(.expired == false)
          | select(.workflow_run.repository_id == $repository and .workflow_run.head_repository_id == $repository)
        ]
        | sort_by(.created_at) | last | .workflow_run.id // empty
    ' || test_app_die 'the artifacts response was not JSON — treating that as a failure, not as "nothing found"'
}

# test_app_write_manifest <platform> <file>
#
# The ONLY producer of a manifest. Reads the values from the environment the build ran in, so what it records is what
# was baked in. A value it cannot state is an error, not a blank.
test_app_write_manifest() {
    local platform="$1" file="$2" built_from built_in distinguishing
    test_app_check_platform "$platform"
    test_app_require_env TEST_APP_CONTENT_KEY EXPO_PUBLIC_RECIPE_API_URL EXPO_PUBLIC_FOOD_API_URL \
        EXPO_PUBLIC_IDENTITY_API_URL EXPO_PUBLIC_IDP_PUBLISHABLE_KEY

    built_from="${GITHUB_SHA:-$(git -C "$TEST_APP_REPO_ROOT" rev-parse HEAD)}"
    built_in="${GITHUB_RUN_ID:-local}"

    if [ "$platform" = 'android' ]; then
        distinguishing="abis=${TEST_APP_ANDROID_ABIS}"
    else
        distinguishing="xcodeVersion=$(test_app_xcode_version)"
    fi

    mkdir -p "$(dirname "$file")"
    {
        printf 'platform=%s\n' "$platform"
        printf 'contentKey=%s\n' "$TEST_APP_CONTENT_KEY"
        printf 'recipeOrigin=%s\n' "$EXPO_PUBLIC_RECIPE_API_URL"
        printf 'foodOrigin=%s\n' "$EXPO_PUBLIC_FOOD_API_URL"
        printf 'identityOrigin=%s\n' "$EXPO_PUBLIC_IDENTITY_API_URL"
        printf 'publishableKeySha256=%s\n' "$(test_app_sha256 "$EXPO_PUBLIC_IDP_PUBLISHABLE_KEY")"
        printf '%s\n' "$distinguishing"
        printf 'builtFromSha=%s\n' "$built_from"
        printf 'builtInRun=%s\n' "$built_in"
    } >"$file"
}

# test_app_verify_manifest <file> <platform>
#
# PURE: reads the file and EXPECT_* from the environment, touches nothing else. Exit 0 only for an EXACT match.
#   EXPECT_CONTENT_KEY EXPECT_RECIPE_ORIGIN EXPECT_FOOD_ORIGIN EXPECT_IDENTITY_ORIGIN EXPECT_PUBLISHABLE_KEY
#   and, on iOS, EXPECT_XCODE_VERSION. (The Android ABI list is this file's own constant.)
#
# ⛔ Every refusal is a guard clause. An expectation that is not stated is refused rather than skipped — a workflow that
# lost a variable would otherwise accept any binary — and a key this function does not know is refused, because a field
# it does not know is a field it did not compare.
test_app_verify_manifest() {
    local file="${1:-}" platform="${2:-}" allowed line key value seen=' ' failures=0 name variable
    test_app_check_platform "$platform"
    [ -n "$file" ] || test_app_die 'verify-manifest needs the manifest file'

    local required='EXPECT_CONTENT_KEY EXPECT_RECIPE_ORIGIN EXPECT_FOOD_ORIGIN EXPECT_IDENTITY_ORIGIN EXPECT_PUBLISHABLE_KEY'
    allowed="${TEST_APP_COMMON_KEYS} ${TEST_APP_PROVENANCE_KEYS}"

    if [ "$platform" = 'android' ]; then
        allowed="${allowed} abis"
    else
        allowed="${allowed} xcodeVersion"
        required="${required} EXPECT_XCODE_VERSION"
    fi

    for name in $required; do
        [ -n "${!name:-}" ] ||
            test_app_die "${name} is not stated — verifying without it would accept any binary"
    done
    [ -f "$file" ] || test_app_die "no test app manifest at ${file}"

    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            *$'\r'*) test_app_die "the manifest has a carriage return — an exact match does not forgive one" ;;
        esac
        [[ "$line" =~ ^([A-Za-z0-9]+)=(.*)$ ]] || test_app_die "manifest line is not key=value: '${line}'"
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"

        case " ${allowed} " in
            *" ${key} "*) ;;
            *) test_app_die "the manifest carries an unknown key '${key}' for ${platform}" ;;
        esac
        case "$seen" in
            *" ${key} "*) test_app_die "the manifest carries '${key}' twice" ;;
        esac

        seen="${seen}${key} "
        printf -v "manifest_${key}" '%s' "$value"
    done <"$file"

    for key in $allowed; do
        case "$seen" in
            *" ${key} "*) ;;
            *) test_app_die "the manifest is missing '${key}'" ;;
        esac
    done

    # Provenance: present, never compared.
    for key in $TEST_APP_PROVENANCE_KEYS; do
        variable="manifest_${key}"
        [ -n "${!variable}" ] || test_app_die "the manifest's '${key}' is blank — provenance may differ, it may not be absent"
    done

    # test_app_expect <key> <expected>  Counts a mismatch; never short-circuits, so one run names every wrong field.
    test_app_expect() {
        local field="$1" expected="$2" actual_variable="manifest_$1"
        if [ "${!actual_variable}" != "$expected" ]; then
            echo "::error::test app manifest field ${field} is '${!actual_variable}' but this run expects '${expected}'" >&2
            failures=$((failures + 1))
        fi
    }

    test_app_expect platform "$platform"
    test_app_expect contentKey "$EXPECT_CONTENT_KEY"
    test_app_expect recipeOrigin "$EXPECT_RECIPE_ORIGIN"
    test_app_expect foodOrigin "$EXPECT_FOOD_ORIGIN"
    test_app_expect identityOrigin "$EXPECT_IDENTITY_ORIGIN"
    test_app_expect publishableKeySha256 "$(test_app_sha256 "$EXPECT_PUBLISHABLE_KEY")"
    if [ "$platform" = 'android' ]; then
        test_app_expect abis "$TEST_APP_ANDROID_ABIS"
    else
        test_app_expect xcodeVersion "$EXPECT_XCODE_VERSION"
    fi

    if [ "$failures" -ne 0 ]; then
        test_app_die "the downloaded ${platform} test app is not the one this run resolved (${failures} field(s) differ) — refusing to drive it"
    fi
}

# test_app_prepare_build <platform>
#
# The part of a build both platforms share: the baked-in values must all be stated, the content key is taken BEFORE any
# build output exists, no secret survives into the build, and an old artifact directory is cleared.
test_app_prepare_build() {
    local platform="$1" name
    test_app_require_env EXPO_PUBLIC_RECIPE_API_URL EXPO_PUBLIC_FOOD_API_URL EXPO_PUBLIC_IDENTITY_API_URL \
        EXPO_PUBLIC_IDP_PUBLISHABLE_KEY

    # ⛔ THE KEY THE WORKFLOW ALREADY PROVED, when it states one. `_mobileAppBuild.yml` computes the key on a clean tree,
    # refuses to build if it differs from the plan's, and passes it in: recomputing here, after `turbo build` has written
    # its outputs into the tree, would ask turbo about a DIFFERENT tree than the one the artifact is named for. Absent (a
    # developer building by hand), it is taken from the tree as checked out.
    TEST_APP_CONTENT_KEY="${TEST_APP_CONTENT_KEY:-$(test_app_content_key "$platform")}"
    export TEST_APP_CONTENT_KEY

    # The release build runs the @sentry/react-native hook that uploads source maps; there is no Sentry token in E2E.
    export SENTRY_DISABLE_AUTO_UPLOAD=true

    for name in $TEST_APP_SECRET_VARIABLES; do
        unset "$name"
    done

    rm -rf "${TEST_APP_MOBILE_DIR}/dist-testApp/${platform}"
    mkdir -p "${TEST_APP_MOBILE_DIR}/dist-testApp/${platform}"
}

test_app_build_android() {
    test_app_prepare_build android
    cd "$TEST_APP_MOBILE_DIR"

    # A Release build embeds the JS bundle; a debug APK loads it from a Metro server that CI does not run. Expo prebuild
    # signs `release` with the debug keystore, so no keystore setup is needed.
    npx expo prebuild --platform android --no-install
    cd android

    # ⛔ CONFIGURE FIRST, AND RETRY — the Android SDK components this build needs are downloaded by Gradle during
    # CONFIGURATION, not compilation, and that download is the least reliable thing here (2026-09-04: "Install NDK
    # (Side by side) 27.1.12297006 failed", which cost the whole tier because no APK was built). No version is named:
    # `ndkVersion` comes from Expo's own Gradle catalog, `android/` is generated, and any literal would be a second copy
    # that drifts with the Expo SDK. `:app:tasks` forces the same configuration phase, so Gradle asks for whatever it
    # needs today. Configuration is ~1-2 minutes against ~12 for the assemble, so a transient failure costs a short retry.
    local attempt
    for attempt in 1 2 3; do
        if ./gradlew :app:tasks --no-daemon -q >/tmp/ndk-configure.log 2>&1; then
            echo "android sdk components resolved (attempt ${attempt})"
            break
        fi
        if [ "$attempt" -eq 3 ]; then
            echo "::error::Gradle could not resolve the Android SDK components after 3 attempts. This is the SDK download, not the app build — no APK was produced and no Maestro flow ran, so nothing below tested the mobile app. Log follows."
            cat /tmp/ndk-configure.log
            exit 1
        fi
        echo "::warning::Android SDK component install failed (attempt ${attempt}/3) — retrying in $((attempt * 20))s"
        sleep "$((attempt * 20))"
    done

    # `-PreactNativeArchitectures` is the ABI list (a Gradle property React Native reads); proguard and resource shrinking
    # stay off so nothing the E2E needs is stripped.
    ./gradlew :app:assembleRelease --no-daemon \
        "-PreactNativeArchitectures=${TEST_APP_ANDROID_ABIS}" \
        -PenableProguardInReleaseBuilds=false -PenableShrinkResourcesInReleaseBuilds=false

    cd "$TEST_APP_MOBILE_DIR"
    cp android/app/build/outputs/apk/release/app-release.apk dist-testApp/android/app.apk
    test_app_write_manifest android dist-testApp/android/testApp.manifest
    echo "built dist-testApp/android/app.apk (content key ${TEST_APP_CONTENT_KEY})"
}

test_app_build_ios() {
    test_app_prepare_build ios
    cd "$TEST_APP_MOBILE_DIR"

    local scratch="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

    npx expo prebuild --platform ios --no-install
    cd ios

    # ⛔ INSTALL PODS SEPARATELY, AND RETRY — the iOS twin of the Gradle-configure retry. The pod downloads (the CocoaPods
    # CDN, React Native's prebuilt artefacts) are the least reliable thing in this build, and a transient failure there
    # must not read as "the app did not build".
    local attempt
    for attempt in 1 2 3; do
        if pod install >"${scratch}/pod-install.log" 2>&1; then
            echo "pods installed (attempt ${attempt})"
            break
        fi
        if [ "$attempt" -eq 3 ]; then
            echo "::error::pod install failed after 3 attempts. This is the dependency download, not the app build — no app was built and no Maestro flow ran. Log follows."
            cat "${scratch}/pod-install.log"
            exit 1
        fi
        echo "::warning::pod install failed (attempt ${attempt}/3) — retrying in $((attempt * 20))s"
        sleep "$((attempt * 20))"
    done

    # ⛔ NO PROJECT NAME IS TYPED HERE. The workspace and scheme are derived by `expo prebuild` from the app's name, so they
    # are discovered — exactly one, or the build refuses — rather than written down.
    local workspaces=(*.xcworkspace)
    if [ "${#workspaces[@]}" -ne 1 ] || [ ! -d "${workspaces[0]}" ]; then
        test_app_die "expected exactly one .xcworkspace from expo prebuild, found: ${workspaces[*]}"
    fi
    local workspace="${workspaces[0]}" derived="${scratch}/ios-derived-data"

    df -h /
    # Signing is left to Xcode's default for the Simulator SDK (ad-hoc, "Sign to Run Locally"), NOT disabled: an unsigned
    # Simulator app carries no application-identifier entitlement, and the keychain `expo-secure-store` keeps the Clerk
    # session in refuses an app without one. `generic/platform=iOS Simulator` and `ARCHS=arm64` because no Simulator is
    # booted in a build job; the shards run on arm64 runners. The raw log stays on the runner (printed on failure) and is
    # never uploaded.
    local beautify=cat
    command -v xcbeautify >/dev/null 2>&1 && beautify='xcbeautify --quiet'
    if ! xcodebuild -workspace "${workspace}" -scheme "${workspace%.xcworkspace}" \
        -configuration Release -sdk iphonesimulator \
        -destination 'generic/platform=iOS Simulator' -derivedDataPath "${derived}" \
        ARCHS=arm64 ONLY_ACTIVE_ARCH=NO \
        build 2>&1 | tee "${scratch}/xcodebuild.log" | $beautify; then
        echo "::error::xcodebuild failed — no app was built and no Maestro flow ran. Raw log tail follows."
        tail -200 "${scratch}/xcodebuild.log"
        exit 1
    fi
    df -h /

    local products="${derived}/Build/Products/Release-iphonesimulator"
    local apps=("${products}/"*.app)
    if [ "${#apps[@]}" -ne 1 ] || [ ! -d "${apps[0]}" ]; then
        test_app_die "expected exactly one Release-iphonesimulator .app bundle, found: ${apps[*]}"
    fi

    # A tarball, because `actions/upload-artifact` drops the executable bit and an .app is full of executables.
    cd "$TEST_APP_MOBILE_DIR"
    tar -czf dist-testApp/ios/app.tar.gz -C "$products" "$(basename "${apps[0]}")"
    test_app_write_manifest ios dist-testApp/ios/testApp.manifest
    echo "built dist-testApp/ios/app.tar.gz (content key ${TEST_APP_CONTENT_KEY})"
}

test_app_main() {
    local command="${1:-}"

    case "$command" in
        android) test_app_build_android ;;
        ios) test_app_build_ios ;;
        content-key) test_app_content_key "${2:-}" ;;
        artifact-name) test_app_artifact_name "${2:-}" "${3:-}" ;;
        key-from-artifact-name) test_app_key_from_artifact_name "${2:-}" "${3:-}" ;;
        xcode-version) test_app_xcode_version ;;
        select-reusable) test_app_select_reusable "${2:-}" "${3:-}" ;;
        write-manifest) test_app_write_manifest "${2:-}" "${3:-}" ;;
        verify-manifest) test_app_verify_manifest "${2:-}" "${3:-}" ;;
        *)
            echo "usage: buildTestApp.sh android | ios | content-key <platform> | artifact-name <platform> <key> | key-from-artifact-name <platform> <name> | xcode-version | select-reusable <repositoryId> <name> | write-manifest <platform> <file> | verify-manifest <file> <platform>" >&2
            exit 2
            ;;
    esac
}

test_app_main "$@"
