#!/usr/bin/env bash
# `npm run local:maestro -- all | flows <flow…> | reset` — run the mobile Maestro flows on a LOCAL Android emulator,
# against the LOCAL sandbox (`npm run local:up`), on a developer's machine.
#
# ⛔ A LOCAL e2e run (docs/CODING_STANDARDS.md §7.1a). It proves the app and the flows against this tree's services;
# it proves NOTHING about a deploy, and no workflow may run it.
#
# ## What it stands up, and what it reuses
#
# - The services are the local sandbox's containers (recipe :3000, identity :3001, food :3002, over Postgres and
#   LocalStack). This script does NOT start them: `local:up` reads the stacks' Secrets Manager and SSM references
#   from real AWS, and this script reads exactly one secret. A stack that is not up is refused with the command to run.
# - The queue consumers `local:up` planned (`bin/queueConsumer.ts` — the account-erasure worker completes the purge
#   `resetPool` waits on), the parse worker (`recipe-workers`' `dev`), the API 34 emulator `ci_pixel6` on serial
#   `emulator-5556`, and Metro are started here when they are not already running, and stopped on exit — only what
#   this run started.
# - The app is the DEBUG APK, with its JavaScript from Metro, so an edit to app code needs no rebuild.
#
# ## Whose per-flow lifecycle
#
# CI's. This script SOURCES `packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh` and calls its
# `maestro_run_flow_list`, so each flow gets CI's driver reset, logcat scoping, `e2e-seed reset` and fixture manifest.
# It does not call CI's `maestro_run_flows`: that one installs the RELEASE APK and reverses only port 3000.
#
# ## The device pin
#
# ⛔ Another emulator (`emulator-5554`) may be attached and is not ours. CI's functions call bare `adb` and `maestro`,
# so both are shadowed below with functions that always name `emulator-5556`. Functions win over PATH, including
# inside the sourced functions. The serial is a literal, not configuration.
#
# ## Secrets and AWS
#
# The only call to real AWS is the read of the sandbox Clerk keys (`kitchensink/sandbox/identity/keys`), the same
# secret `.github/actions/load-secrets` reads. The keys are written once to owner-only files under the state
# directory (outside the repository), read back with the `read` builtin, and are never on an argv and never printed.
# Everything after that read runs with AWS pinned to LocalStack and throwaway credentials.
#
# ⚠️ The Clerk users are the Maestro tier's FIXED pool slots for shard 1, the same users CI's
# `test-pool-sandbox-maestro-1` group signs in. Their DATA here lives in the local database, so a local run cannot
# disturb a CI run's world, but both sign the same users in. ⚠️ They also lease the same ERASURE subjects, and this
# run holds no lane: run concurrently with a CI shard-1 job and both may take the same subject, so one erasure fails
# (`maestroErasureSlots` in testPool.ts records it). This run does not refill the subjects — CI's job does, through
# `poolAdmin`.

set -uo pipefail

LOCAL_MAESTRO_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
LOCAL_MAESTRO_MOBILE_DIR="${LOCAL_MAESTRO_REPO_ROOT}/packages/apps/commise/mobile"
LOCAL_MAESTRO_FLOWS_DIR="${LOCAL_MAESTRO_MOBILE_DIR}/.maestro"
LOCAL_MAESTRO_DEBUG_APK="${LOCAL_MAESTRO_MOBILE_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"
LOCAL_MAESTRO_SERIAL='emulator-5556'
LOCAL_MAESTRO_AVD='ci_pixel6'
LOCAL_MAESTRO_CLERK_SECRET_ID='kitchensink/sandbox/identity/keys'
LOCAL_MAESTRO_METRO_PORT=8081
# The local sandbox's ports — each service's own `PORT` default (see `localPortFor` in `adapters.ts`).
LOCAL_MAESTRO_RECIPE_ORIGIN='http://localhost:3000'
LOCAL_MAESTRO_IDENTITY_ORIGIN='http://localhost:3001'
LOCAL_MAESTRO_FOOD_ORIGIN='http://localhost:3002'
# ⛔ The `azp` the seeder's tokens carry must be one the services admit: `localContainerEnv` sets
# `CLERK_AUTHORIZED_PARTIES` to this origin.
LOCAL_MAESTRO_WEB_ORIGIN='http://localhost:3000'
LOCAL_MAESTRO_LOCALSTACK='http://localhost:4566'

# Processes this run started, as process-group ids (each is started under `setsid`), and whether it booted the emulator.
LOCAL_MAESTRO_STARTED_GROUPS=()
LOCAL_MAESTRO_STARTED_EMULATOR=false

# shellcheck source=../../../apps/commise/mobile/tests/e2e/runMaestroFlows.sh
. "${LOCAL_MAESTRO_MOBILE_DIR}/tests/e2e/runMaestroFlows.sh"

# Shadowed AFTER sourcing, so CI's functions resolve these rather than the binaries on PATH.
adb() {
    command adb -s emulator-5556 "$@"
}

maestro() {
    command maestro --device emulator-5556 "$@"
}

local_maestro_fail() {
    echo "local:maestro: $*" >&2
    return 1
}

# The state directory: keys, the seeder's sessions and manifest, logs. Refused inside the repository, so nothing it
# holds can be staged.
local_maestro_state_dir() {
    local dir="${LOCAL_MAESTRO_STATE_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}/kitchensink/localMaestro}"
    local resolved
    resolved="$(realpath -m -- "$dir")" || return 1

    case "${resolved}/" in
        "${LOCAL_MAESTRO_REPO_ROOT}/"*)
            local_maestro_fail "the state directory ${resolved} is inside the repository — it holds credentials"
            return 1
            ;;
    esac

    (umask 077 && mkdir -p -- "$resolved") || return 1
    printf '%s\n' "$resolved"
}

# Print the flows a command runs, one per line, or refuse. Prints nothing unless every named flow is valid.
local_maestro_flows() {
    case "${1-}" in
        all)
            local verdict
            verdict="$(maestro_select_flows "$FLOW_PLAN")" || return 1
            printf '%s\n' "$verdict" | sed -n 's/^flow=//p'
            ;;
        flows)
            shift
            if [ "$#" -eq 0 ]; then
                local_maestro_fail 'name at least one flow, e.g. `flows recipes/create`'
                return 2
            fi

            local flow name selected=() bad=0
            for flow in "$@"; do
                name="${flow%.yaml}"
                case "/${name}/" in
                    //* | */../* | */./*)
                        local_maestro_fail "'${flow}' is not a flow under .maestro/"
                        bad=1
                        continue
                        ;;
                esac
                if [ ! -f "${LOCAL_MAESTRO_FLOWS_DIR}/${name}.yaml" ]; then
                    local_maestro_fail "no flow '${flow}' (looked for .maestro/${name}.yaml)"
                    bad=1
                    continue
                fi
                selected+=("$name")
            done

            [ "$bad" -eq 0 ] || return 1
            printf '%s\n' "${selected[@]}"
            ;;
        *)
            local_maestro_fail 'usage: local:maestro -- all | flows <flow…> | reset'
            return 2
            ;;
    esac
}

# Refuse a served bundle whose env modules name any origin but loopback. In a dev bundle Expo spreads the project's
# `.env` files over `process.env`, so the BUNDLE decides the backend (see maestroMetro.config.cjs).
local_maestro_check_bundle_env() {
    local bundle="$1"
    if [ ! -s "$bundle" ]; then
        local_maestro_fail "the Metro bundle is empty — nothing was checked"
        return 1
    fi

    local remote
    remote="$(grep -oE '"EXPO_PUBLIC_[A-Z0-9_]+": ?"https?://[^"]*"' "$bundle" |
        grep -vE '"https?://(localhost|127\.0\.0\.1|10\.0\.2\.2)(:[0-9]+)?(/[^"]*)?"$' | sort -u)"
    if [ -n "$remote" ]; then
        local_maestro_fail "the app bundle names a non-local origin, so the app would not read the local services:"
        printf '%s\n' "$remote" | sed 's/^/  /' >&2
        return 1
    fi
}

# Read the sandbox Clerk keys — once — and export them. The one call to real AWS.
local_maestro_load_clerk_keys() {
    local state secrets
    state="$(local_maestro_state_dir)" || return 1
    secrets="${state}/secrets"
    (umask 077 && mkdir -p -- "$secrets") && chmod 700 -- "$secrets" || return 1

    if [ ! -s "${secrets}/clerkSecretKey" ] || [ ! -s "${secrets}/clerkPublishableKey" ]; then
        local document secret publishable
        # ⛔ With every LocalStack override removed: this one read is of the real secret.
        if ! document="$(env -u AWS_ENDPOINT_URL -u AWS_ENDPOINT_URL_SECRETS_MANAGER \
            aws secretsmanager get-secret-value --secret-id "$LOCAL_MAESTRO_CLERK_SECRET_ID" \
            --region "${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}" --query SecretString --output text)"; then
            local_maestro_fail "could not read ${LOCAL_MAESTRO_CLERK_SECRET_ID} from Secrets Manager (are your AWS credentials live?)"
            return 1
        fi

        secret="$(printf '%s' "$document" | jq -r '.SECRET_KEY // empty' 2>/dev/null)"
        publishable="$(printf '%s' "$document" | jq -r '.PUBLISHABLE_KEY // empty' 2>/dev/null)"
        document=''

        if [ -z "$secret" ] || [ -z "$publishable" ]; then
            local_maestro_fail "${LOCAL_MAESTRO_CLERK_SECRET_ID} has no SECRET_KEY or PUBLISHABLE_KEY"
            return 1
        fi

        (
            umask 077
            printf '%s\n' "$secret" >"${secrets}/clerkSecretKey"
            printf '%s\n' "$publishable" >"${secrets}/clerkPublishableKey"
        ) || return 1
        secret=''
        publishable=''
    fi

    IFS= read -r CLERK_SECRET_KEY <"${secrets}/clerkSecretKey" || return 1
    IFS= read -r CLERK_PUBLISHABLE_KEY <"${secrets}/clerkPublishableKey" || return 1
    export CLERK_SECRET_KEY CLERK_PUBLISHABLE_KEY
}

# Pin every AWS SDK client and CLI call from here on to LocalStack, with throwaway credentials.
local_maestro_pin_aws() {
    unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SESSION_TOKEN AWS_SECURITY_TOKEN AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE
    export AWS_ENDPOINT_URL="$LOCAL_MAESTRO_LOCALSTACK"
    export AWS_ACCESS_KEY_ID='test'
    export AWS_SECRET_ACCESS_KEY='test'
    export AWS_REGION='us-east-1'
    export AWS_DEFAULT_REGION='us-east-1'
    # ⚠️ Without these the SDK still falls back to `~/.aws` for the profile it was told nothing about.
    export AWS_CONFIG_FILE=/dev/null
    export AWS_SHARED_CREDENTIALS_FILE=/dev/null
}

# ── The impure half: toolchain, device, Metro, services. Exercised by running it, not by the unit suite. ──────────

local_maestro_toolchain() {
    local node24
    node24="$(ls -d "${HOME}"/.nvm/versions/node/v24.* 2>/dev/null | sort -V | tail -1)"
    if [ -n "$node24" ]; then
        PATH="${node24}/bin:${PATH}"
    fi

    export ANDROID_HOME="${ANDROID_HOME:-${HOME}/android-sdk}"
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
    # ⚠️ Not `JAVA_HOME`: the default `java` here is 11, which neither Maestro 2 nor the Android build accepts.
    export JAVA_HOME="${LOCAL_MAESTRO_JAVA_HOME:-${HOME}/jdk17}"
    export PATH="${JAVA_HOME}/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:${HOME}/.maestro/bin:${PATH}"
    export ANDROID_SERIAL="$LOCAL_MAESTRO_SERIAL"
    export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"
    export MAESTRO_CLI_NO_ANALYTICS=1

    local tool missing=0
    for tool in node npx docker curl jq aws adb emulator maestro java setsid; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            local_maestro_fail "missing tool: ${tool}"
            missing=1
        fi
    done
    [ "$missing" -eq 0 ] || return 1

    case "$(node -v)" in
        v24.*) ;;
        *) local_maestro_fail "Node 24 is required (found $(node -v))" || return 1 ;;
    esac

    local version
    version="$(command maestro --version 2>/dev/null | tail -1)"
    if [ "$version" != '2.6.1' ]; then
        echo "local:maestro: ⚠️ Maestro ${version:-unknown} — CI pins 2.6.1" >&2
    fi
}

# Start a command in its own session (so the whole tree can be stopped), logging to a file. Sets
# LOCAL_MAESTRO_LAST_PID.
local_maestro_spawn() {
    local log="$1"
    shift
    setsid "$@" </dev/null >"$log" 2>&1 &
    LOCAL_MAESTRO_LAST_PID=$!
    LOCAL_MAESTRO_STARTED_GROUPS+=("$LOCAL_MAESTRO_LAST_PID")
}

local_maestro_cleanup() {
    local status=$?
    trap - EXIT INT TERM

    command adb -s emulator-5556 reverse --remove-all >/dev/null 2>&1 || true

    if [ "$LOCAL_MAESTRO_STARTED_EMULATOR" = 'true' ]; then
        echo "local:maestro: stopping the emulator it started (${LOCAL_MAESTRO_SERIAL})" >&2
        command adb -s emulator-5556 emu kill >/dev/null 2>&1 || true
    fi

    local group waited
    for group in "${LOCAL_MAESTRO_STARTED_GROUPS[@]}"; do
        kill -TERM -- "-${group}" 2>/dev/null || continue
        for waited in 1 2 3 4 5 6 7 8 9 10; do
            kill -0 -- "-${group}" 2>/dev/null || break
            sleep 1
        done
        kill -KILL -- "-${group}" 2>/dev/null || true
    done

    exit "$status"
}

local_maestro_require_services() {
    local origin down=0
    for origin in "$LOCAL_MAESTRO_RECIPE_ORIGIN" "$LOCAL_MAESTRO_IDENTITY_ORIGIN" "$LOCAL_MAESTRO_FOOD_ORIGIN"; do
        if ! curl -fsS --max-time 5 -o /dev/null "${origin}/health"; then
            local_maestro_fail "${origin}/health does not answer"
            down=1
        fi
    done
    if [ "$down" -ne 0 ]; then
        local_maestro_fail 'the local sandbox is not up — run `npm run local:up` first'
        return 1
    fi
}

local_maestro_start_worker() {
    local state="$1"
    if pgrep -f 'recipe-workers.*src/local/main.ts|src/local/main\.ts' >/dev/null 2>&1; then
        echo 'local:maestro: a parse worker is already running — reusing it' >&2
        return 0
    fi

    echo 'local:maestro: starting the parse worker (recipe-workers dev)' >&2
    local_maestro_spawn "${state}/worker.log" npm run dev --workspace=@kitchensink/recipe-workers
    sleep 8
    if ! kill -0 "$LOCAL_MAESTRO_LAST_PID" 2>/dev/null; then
        tail -20 "${state}/worker.log" >&2
        local_maestro_fail "the parse worker exited — log: ${state}/worker.log"
        return 1
    fi
}

# The queue consumers `local:up` planned (`.local-sandbox/queueConsumers.json`) — the account-erasure worker among
# them, which completes the test-principal purge `resetPool` waits on.
local_maestro_start_consumers() {
    local state="$1"
    local plan="${LOCAL_MAESTRO_REPO_ROOT}/.local-sandbox/queueConsumers.json"
    if [ ! -s "$plan" ]; then
        local_maestro_fail 'no queue-consumer plan — run `npm run local:up` (it writes .local-sandbox/queueConsumers.json)'
        return 1
    fi

    local name log waited
    for name in $(jq -r '.[].name' "$plan"); do
        if pgrep -f "bin/queueConsumer.ts ${name}( |$)" >/dev/null 2>&1; then
            echo "local:maestro: the ${name} queue consumer is already running — reusing it" >&2
            continue
        fi

        echo "local:maestro: starting the ${name} queue consumer" >&2
        log="${state}/consumer.${name}.log"
        local_maestro_spawn "$log" npx tsx packages/tools/local-sandbox/bin/queueConsumer.ts "$name"
        # Alive AND polling, checked now: a consumer that died would otherwise surface as a five-minute purge timeout.
        for ((waited = 0; waited < 60; waited += 1)); do
            grep -q 'draining' "$log" 2>/dev/null && break
            if ! kill -0 "$LOCAL_MAESTRO_LAST_PID" 2>/dev/null; then
                tail -20 "$log" >&2
                local_maestro_fail "the ${name} queue consumer exited — log: ${log}"
                return 1
            fi
            sleep 1
        done
        grep -q 'draining' "$log" 2>/dev/null || {
            local_maestro_fail "the ${name} queue consumer did not start polling in 60s — log: ${log}"
            return 1
        }
    done
}

local_maestro_start_emulator() {
    local state="$1"
    if [ "$(command adb -s emulator-5556 get-state 2>/dev/null)" = 'device' ]; then
        echo "local:maestro: ${LOCAL_MAESTRO_SERIAL} is attached — reusing it" >&2
    else
        local args=(-avd "$LOCAL_MAESTRO_AVD" -port 5556 -no-window -no-audio -no-boot-anim
            -gpu swiftshader_indirect -no-snapshot)
        # Another instance of the same AVD (on the serial that is not ours) locks it; a read-only boot does not.
        local serial
        for serial in $(command adb devices | sed -n 's/^\(emulator-[0-9]*\)[[:space:]].*/\1/p'); do
            if [ "$serial" != "$LOCAL_MAESTRO_SERIAL" ] &&
                command adb -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r' | grep -qx "$LOCAL_MAESTRO_AVD"; then
                args+=(-read-only)
            fi
        done

        echo "local:maestro: booting ${LOCAL_MAESTRO_AVD} on ${LOCAL_MAESTRO_SERIAL}" >&2
        local_maestro_spawn "${state}/emulator.log" emulator "${args[@]}"
        LOCAL_MAESTRO_STARTED_EMULATOR=true
    fi

    local waited
    for ((waited = 0; waited < 300; waited += 5)); do
        if [ "$(command adb -s emulator-5556 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = '1' ]; then
            return 0
        fi
        sleep 5
    done
    local_maestro_fail "${LOCAL_MAESTRO_SERIAL} did not finish booting in 300s — log: ${state}/emulator.log"
}

local_maestro_start_metro() {
    local state="$1"
    if ss -lntH "sport = :${LOCAL_MAESTRO_METRO_PORT}" | grep -q .; then
        # ⛔ Refused, not reused: a Metro this run did not start may be serving the app bundled against other
        # origins (the mobile `.env.local` names a deployed preview), which is the documented way the app and the
        # seeder end up reading two different databases.
        local_maestro_fail "port ${LOCAL_MAESTRO_METRO_PORT} is in use — stop that Metro so this run can start one against the local services"
        return 1
    fi

    echo 'local:maestro: starting Metro against the local services' >&2
    # ⛔ The app's `.env.local` must not win: the override config hides it from Metro (a dev bundle spreads `.env` files
    # over `process.env`), and EXPO_NO_DOTENV keeps it out of Metro's own environment. What remains is the committed
    # `.env.development` — the canonical local ports, reversed below — plus the values exported here.
    # Not CI=1, which turns Metro's file watcher off and serves a stale bundle after an edit.
    (
        cd "$LOCAL_MAESTRO_MOBILE_DIR" || exit 1
        export EXPO_NO_DOTENV=1
        export EXPO_OVERRIDE_METRO_CONFIG="${LOCAL_MAESTRO_REPO_ROOT}/packages/tools/local-sandbox/maestroMetro.config.cjs"
        export EXPO_PUBLIC_RECIPE_API_URL="$LOCAL_MAESTRO_RECIPE_ORIGIN"
        export EXPO_PUBLIC_IDENTITY_API_URL="$LOCAL_MAESTRO_IDENTITY_ORIGIN"
        export EXPO_PUBLIC_FOOD_API_URL="$LOCAL_MAESTRO_FOOD_ORIGIN"
        export EXPO_PUBLIC_IDP_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY"
        unset CLERK_SECRET_KEY
        local_maestro_spawn "${state}/metro.log" npx expo start --port "$LOCAL_MAESTRO_METRO_PORT" --clear
        printf '%s\n' "$LOCAL_MAESTRO_LAST_PID" >"${state}/metro.pid"
    ) || return 1
    LOCAL_MAESTRO_STARTED_GROUPS+=("$(cat "${state}/metro.pid")")

    local waited
    for ((waited = 0; waited < 120; waited += 2)); do
        if curl -fsS --max-time 2 "http://localhost:${LOCAL_MAESTRO_METRO_PORT}/status" 2>/dev/null | grep -q 'packager-status:running'; then
            return 0
        fi
        # Metro reports a config error and keeps the process alive, so its log is the only early signal.
        if grep -q '^Error: ' "${state}/metro.log" 2>/dev/null; then
            break
        fi
        sleep 2
    done
    tail -20 "${state}/metro.log" >&2
    local_maestro_fail "Metro did not come up — log: ${state}/metro.log"
}

local_maestro_install_app() {
    local state="$1"
    if [ ! -f "$LOCAL_MAESTRO_DEBUG_APK" ]; then
        if [ "${LOCAL_MAESTRO_BUILD_APK:-}" != '1' ]; then
            local_maestro_fail "no debug APK at ${LOCAL_MAESTRO_DEBUG_APK} — rerun with LOCAL_MAESTRO_BUILD_APK=1 to build it (several minutes)"
            return 1
        fi
    fi

    if [ "${LOCAL_MAESTRO_BUILD_APK:-}" = '1' ]; then
        echo 'local:maestro: building the debug APK (expo prebuild + gradle assembleDebug)' >&2
        (
            cd "$LOCAL_MAESTRO_MOBILE_DIR" &&
                CI=1 npx expo prebuild --platform android --no-install &&
                cd android && ./gradlew :app:assembleDebug
        ) || {
            local_maestro_fail 'the debug APK build failed'
            return 1
        }
    fi

    adb install -r "$LOCAL_MAESTRO_DEBUG_APK" >/dev/null || {
        local_maestro_fail 'adb install of the debug APK failed'
        return 1
    }

    local port
    for port in "$LOCAL_MAESTRO_METRO_PORT" 3000 3001 3002; do
        adb reverse "tcp:${port}" "tcp:${port}" >/dev/null || return 1
    done
    # The app's committed `.env.development` names identity at :4000 (the spec's local table); the local sandbox
    # serves it at :3001 (its own `PORT` default).
    adb reverse tcp:4000 tcp:3001 >/dev/null || return 1
    # The two device settings CI's `maestro_run_flows` makes before its flows.
    adb shell settings put secure spell_checker_enabled 0 || true
    adb shell settings put secure show_ime_with_hard_keyboard 0 || true

    # The first flow's launch would otherwise wait out a cold bundle — and the bundle is what names the backend.
    echo 'local:maestro: building and checking the Metro bundle' >&2
    local bundle="${state}/bundle.js"
    curl -fsS --max-time 600 -o "$bundle" \
        "http://localhost:${LOCAL_MAESTRO_METRO_PORT}/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false" || {
        local_maestro_fail 'Metro could not build the app bundle'
        return 1
    }
    local_maestro_check_bundle_env "$bundle"
}

local_maestro_seed_env() {
    local state="$1"
    export E2E_SEED_RECIPE_URL="$LOCAL_MAESTRO_RECIPE_ORIGIN"
    export E2E_SEED_FOOD_URL="$LOCAL_MAESTRO_FOOD_ORIGIN"
    export E2E_SEED_WEB_ORIGIN="$LOCAL_MAESTRO_WEB_ORIGIN"
    export E2E_SEED_STATE_DIR="$state"
    export COMMISE_E2E_SHARD=1
    export MAESTRO_FIXTURE_ENV_FILE="${state}/e2e-seed/fixture.env"
}

local_maestro_reset_pool() {
    npx tsx packages/tools/e2e-seed/src/resetPool.ts --tier maestro --shard 1
}

# Give the shard's pool users, in the LOCAL identity database, the app-user id their Clerk `external_id` names.
# ⛔ The `external_id` names the SANDBOX identity database's row (its webhook wrote it), and recipe-service takes a
# recipe's owner from it; the local identity would otherwise mint a fresh id on the device's first request, and the
# app would hide every owner control on the cook's own recipes. Clerk is never written: CI's deployed tier shares it.
local_maestro_align_identities() {
    npx tsx packages/tools/local-sandbox/bin/alignIdentities.ts
}

local_maestro_main() {
    local command="${1-}"
    local flows=''

    case "$command" in
        all | flows)
            flows="$(local_maestro_flows "$@")" || return 1
            ;;
        reset) ;;
        *)
            local_maestro_flows "$@"
            return
            ;;
    esac

    cd "$LOCAL_MAESTRO_REPO_ROOT" || return 1
    local_maestro_toolchain || return 1

    local state
    state="$(local_maestro_state_dir)" || return 1
    local_maestro_load_clerk_keys || return 1
    local_maestro_pin_aws
    local_maestro_seed_env "$state"
    local_maestro_require_services || return 1

    trap local_maestro_cleanup EXIT
    trap 'exit 130' INT TERM

    local_maestro_start_consumers "$state" || return 1

    if [ "$command" = 'reset' ]; then
        local_maestro_reset_pool || return 1
        rm -rf -- "${state}/e2e-seed"
        echo 'local:maestro: the pool slots are empty and the run state is cleared' >&2
        return 0
    fi

    local_maestro_start_worker "$state" || return 1
    local_maestro_start_emulator "$state" || return 1
    local_maestro_start_metro "$state" || return 1
    local_maestro_install_app "$state" || return 1

    echo 'local:maestro: resetting the pool slots and seeding the world (e2e-seed)' >&2
    local_maestro_reset_pool || return 1
    local_maestro_align_identities || {
        local_maestro_fail 'the local identity database could not be aligned with the Clerk external_ids'
        return 1
    }
    mkdir -p -- "${state}/e2e-seed"
    if ! npx tsx packages/tools/e2e-seed/src/provision.ts >"$MAESTRO_FIXTURE_ENV_FILE"; then
        local_maestro_fail 'e2e-seed provision failed — the local services did not accept the seeded world'
        return 1
    fi

    local rc=0
    # shellcheck disable=SC2086 # one flow name per word, as CI passes them
    maestro_run_flow_list $flows || rc=1

    # CI resets after the flows as well, so the next run starts from an empty slot.
    local_maestro_reset_pool || echo 'local:maestro: ⚠️ the after-run pool reset failed' >&2

    if [ "$rc" -eq 0 ]; then
        echo "local:maestro: PASSED — $(printf '%s ' $flows)" >&2
    else
        echo "local:maestro: FAILED — see the FLOW FAILED lines above" >&2
    fi
    return "$rc"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    local_maestro_main "$@"
fi
