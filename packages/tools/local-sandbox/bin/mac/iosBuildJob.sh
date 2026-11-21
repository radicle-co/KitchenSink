#!/usr/bin/env bash
# The iOS test-app build, run ON the Mac as one job (CL-MACLOCK, staff S91). `buildIosApp.sh build` uploads a snapshot of
# the source to `ksIos/build.noindex/jobs/<jobId>/src/` and starts this script from it:
#
#   iosBuildJob.sh <jobId> <content key> <app folder> [waitLimitSeconds=10800] [buildLimitSeconds=5400]
#
# One build at a time. The job takes a kernel `flock` on `ksIos/build.noindex/build.lock` and keeps it until it exits, so
# the kernel frees it when this process ends, however it ends, and nobody ever breaks a lock. Then it syncs its own
# snapshot into the shared build tree `work/src` (which keeps `node_modules`, `.turbo` and the generated folders between
# builds), builds, and publishes the app by staged rename to `<app folder>`. Nothing here writes a path the old
# `buildIosApp.sh` wrote (`build.noindex/{src,tmp,build.sh,build.rc,build.log,lock.sha}`, `ksIos/apps/<key>`), so an old
# build still running cannot touch a new one, and the reverse.
#
# The build runs as ONE child in a process group of its own, with fd 9 (the lock) closed, so a daemon the build starts
# cannot hold the lock, and so every exit path (the end of the build, TERM, INT) can stop the whole group before this
# process lets go of the lock. HUP is not trapped: `nohup` ignores it, and a trap would let a dropped ssh link kill a
# build.
#
# Environment, as words before `bash` (the client passes them): EXPO_PUBLIC_*, DEVELOPER_DIR, PATH, GITHUB_SHA,
# KS_NODE_BIN. Runs on the Mac's bash 3.2: no `wait -n`, no `${x,,}`.
#
# Exit codes: the build's own; 143 on TERM or INT; 124 when the build ran past its limit; 75 when the lock was not
# taken in time or an earlier build's process group still runs (the message names it).
#
# Still open: a `kill -9` of this process while a build runs leaves the build's group alive. The next job refuses to build
# beside it (exit 75, group named) until it is stopped, and does not guess at a group id it cannot match by start time.
set -euo pipefail

die() {
    echo "iosBuildJob: $*" >&2
    exit 1
}

job="${1:?a job id}"
key="${2:?a content key}"
app="${3:?an app folder}"
wait_limit="${4:-10800}"
build_limit="${5:-5400}"
[[ "$job" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "'$job' is not a job id"
[[ "$key" =~ ^[A-Za-z0-9]+$ ]] || die "'$key' is not a content key"
[[ "$app" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] && [[ "/$app/" != *"/../"* ]] || die "'$app' is not a relative path of plain names"

root="$HOME/ksIos/build.noindex"
cd "$root"
mine="jobs/$job"
[[ "$wait_limit" =~ ^[0-9]+$ && "$build_limit" =~ ^[0-9]+$ ]] || die 'the limits are whole numbers of seconds'
[ -d "$mine/src" ] || die "no snapshot at $root/$mine/src"

child=''
locked=0

# One line of what this job is doing; the client prints it each time it changes.
say() {
    printf '%s\n' "$1" > "$mine/state.tmp"
    mv "$mine/state.tmp" "$mine/state"
}

# The wrapper's pid and the boot it ran in, so the client can tell a dead wrapper from a slow one.
boot_id() {
    sysctl -n kern.boottime 2> /dev/null || cat /proc/sys/kernel/random/boot_id
}
printf '%s %s\n' "$$" "$(boot_id | tr ' \n' '__')" > "$mine/wrapper"

# Ends the build's whole process group: TERM, a bounded wait, then KILL. Safe to call twice.
end_group() {
    [ -n "$child" ] || return 0
    kill -TERM -- "-$child" 2> /dev/null || kill -TERM "$child" 2> /dev/null || true
    local i
    for i in $(seq 1 100); do
        kill -0 -- "-$child" 2> /dev/null || break
        sleep 0.1
    done
    kill -KILL -- "-$child" 2> /dev/null || true
}

on_exit() {
    end_group
    rm -rf "$mine/src"
    # Only the holder says "released": a job that never held the lock must not overwrite the live holder's record.
    [ "$locked" = 1 ] || return 0
    printf 'released job=%s since=%s\n' "$job" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build.owner.tmp
    mv build.owner.tmp build.owner
}
trap on_exit EXIT
trap 'exit 143' TERM INT

# Emulated flock (fcntl) dies with its perl, which is no exclusion at all, and nothing would say so.
perl -MConfig -e 'exit($Config{d_flock} eq "define" ? 0 : 1)' || die 'this perl has no native flock; the build lock would not hold'

# Old job folders go: finished ones, and ones whose wrapper is gone (dead, or the Mac booted since). A folder whose
# wrapper is alive is never touched. So do staging folders a publish left behind.
prune() {
    local folder pid boot now
    now="$(boot_id | tr ' \n' '__')"

    for folder in jobs/*; do
        pid=''
        boot=''
        [ -d "$folder" ] && [ "$folder" != "$mine" ] || continue
        [ -n "$(find "$folder" -maxdepth 0 -mmin +2880 2> /dev/null)" ] || continue
        [ ! -f "$folder/wrapper" ] || read -r pid boot < "$folder/wrapper" || true

        if [ -f "$folder/build.rc" ] || [ -z "$pid" ] || ! kill -0 "$pid" 2> /dev/null || [ "$boot" != "$now" ]; then
            rm -rf "$folder"
        fi
    done

    find "$HOME/ksIos/apps/ios" -maxdepth 1 \( -name '.staging.*' -o -name '*.old.*' \) -mmin +1440 -exec rm -rf {} + 2> /dev/null || true
}
prune

# An earlier build's process group that outlived its wrapper (`kill -9`) still holds the shared tree, though the kernel
# freed the lock. The record names it; the start time stops a reused group id from blocking a build.
refuse_if_earlier_build_runs() {
    local record group start live holder
    record="$(cat build.owner 2> /dev/null || true)"
    group="$(printf '%s' "$record" | sed -n 's/.* pgid=\([0-9][0-9]*\) .*/\1/p')"
    start="$(printf '%s' "$record" | sed -n 's/.* lstart=//p')"
    holder="$(printf '%s' "$record" | sed -n 's/^job=\([^ ]*\) .*/\1/p')"
    [ -n "$group" ] && [ -n "$start" ] || return 0
    kill -0 -- "-$group" 2> /dev/null || return 0
    live="$(ps -o lstart= -p "$group" 2> /dev/null | sed 's/^ *//;s/ *$//')"
    [ "$live" = "$start" ] || return 0
    echo "iosBuildJob: an earlier build (job $holder, process group $group) still runs; stop it, then build again" >&2
    exit 75
}

# The lock. perl takes it through fd 9; the flock belongs to the open file description, so it stays with this shell after
# perl exits. Exit 0 locked, 1 busy, 2 any other error (which must never read as "busy" and wait for ever).
try_lock() {
    perl -e 'use Fcntl qw(:flock); open(my $f, ">&=", 9) or exit 2; if (flock($f, LOCK_EX|LOCK_NB)) { exit 0 } exit(($!{EWOULDBLOCK}) ? 1 : 2)'
}
# The inode of what fd 9 holds and of the lock file's path: they differ when someone removed the file after we opened it.
inode_of_fd9() {
    perl -e 'open(my $f, "<&=", 9) or exit 2; print((stat($f))[1])'
}
inode_of_path() {
    perl -e 'print((stat($ARGV[0]))[1])' build.lock
}

waited_from=$SECONDS
while :; do
    exec 9>> build.lock
    rc=0
    try_lock || rc=$?
    case "$rc" in
        0)
            [ "$(inode_of_fd9)" = "$(inode_of_path)" ] && break
            ;;
        1)
            holder="$(cat build.owner 2> /dev/null || echo 'holder unknown')"
            say "waiting for the build lock: $holder"

            if [ $((SECONDS - waited_from)) -ge "$wait_limit" ]; then
                echo "iosBuildJob: gave up waiting for the build lock after ${wait_limit}s: $holder" >&2
                exit 75
            fi

            sleep 1
            ;;
        *) die 'could not take the build lock (flock failed for a reason other than "busy")' ;;
    esac
done

refuse_if_earlier_build_runs
locked=1
printf 'job=%s pid=%s pgid=- since=%s\n' "$job" "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build.owner.tmp
mv build.owner.tmp build.owner

# Into the shared build tree: by CONTENT (size and time can match across two squads' trees), keeping what the build keeps.
say 'syncing'
mkdir -p work/src work/tmp
rsync -a --checksum --delete \
    --exclude 'node_modules/' --exclude '.turbo/' --exclude 'dist/' --exclude 'dist-*/' --exclude 'distSeed/' \
    --exclude '/packages/apps/commise/mobile/ios/' --exclude '/packages/apps/commise/mobile/android/' \
    "$mine/src/" work/src/
rm -rf "$mine/src"

lock_sha="$(shasum -a 256 work/src/package-lock.json | cut -d' ' -f1)"
sha="${GITHUB_SHA:-}"
node_bin="${KS_NODE_BIN:-$(ls -d "$HOME"/.nvm/versions/node/v24*/bin 2> /dev/null | sort -V | tail -1 || true)}"
[ -z "$node_bin" ] || PATH="$node_bin:$PATH"
# The lockfile names registry.npmjs.org, and npm rewrites that host to whatever the Mac user's ~/.npmrc configures (an
# employer registry that is not always reachable). The build must not depend on it.
export npm_config_registry=https://registry.npmjs.org/
export PATH LANG=en_US.UTF-8 TEST_APP_CONTENT_KEY="$key" GITHUB_SHA="$sha" RUNNER_TEMP="$root/work/tmp" LOCK_SHA="$lock_sha"

steps=$(
    cat << 'STEPS'
set -e
cd "$HOME/ksIos/build.noindex/work/src"
if [ "$(cat ../lock.sha 2>/dev/null)" != "$LOCK_SHA" ] || [ ! -d node_modules ]; then rm -f ../lock.sha; npm ci; echo "$LOCK_SHA" > ../lock.sha; fi
mkdir -p "$RUNNER_TEMP"
npx turbo run build --filter='@commise/mobile^...'
bash packages/apps/commise/mobile/scripts/buildTestApp.sh ios
STEPS
)

say 'building'
# The build is ONE child in a group of its own. It records the group before it touches the tree, and refuses to build if
# this process has already gone (its parent would then be init). fd 9 is closed for it: a daemon it starts cannot hold
# the lock.
perl -e '
    my ($owner, $job, $wrapper, @cmd) = @ARGV;
    setpgrp(0, 0);
    open(my $o, ">", "$owner.tmp") or exit 2;
    my $lstart = `ps -o lstart= -p $$`;
    $lstart =~ s/^\s+|\s+$//g;
    print $o "job=$job pid=$wrapper pgid=$$ since=" . scalar(gmtime) . " lstart=$lstart\n";
    close($o);
    rename("$owner.tmp", $owner) or exit 2;
    exit 1 if getppid() != $wrapper;
    exec @cmd or exit 127;
' "$root/build.owner" "$job" "$$" bash -c "$steps" 9>&- &
child=$!

# Polled, not waited for, so the limit can end a build that never ends (`wait` would sit there with the lock held).
rc=0
building_from=$SECONDS
while kill -0 "$child" 2> /dev/null; do
    if [ $((SECONDS - building_from)) -ge "$build_limit" ]; then
        echo "iosBuildJob: the build ran past its limit of ${build_limit}s; stopping it" >&2
        rc=124
        break
    fi

    sleep 0.5
done
[ "$rc" = 124 ] || wait "$child" || rc=$?
end_group
[ "$rc" = 0 ] || exit "$rc"

# Publish by staged rename: a reader sees a whole app or none.
say 'publishing'
dest="$HOME/$app"
stage="$(dirname "$dest")/.staging.$job"
mkdir -p "$(dirname "$dest")"
rm -rf "$stage"
mkdir -p "$stage"
cp work/src/packages/apps/commise/mobile/dist-testApp/ios/* "$stage"/
tar -xzf "$stage/app.tar.gz" -C "$stage"
if [ -e "$dest" ]; then mv "$dest" "$dest.old.$job"; fi
mv "$stage" "$dest"
rm -rf "$dest.old.$job"
say 'done'
