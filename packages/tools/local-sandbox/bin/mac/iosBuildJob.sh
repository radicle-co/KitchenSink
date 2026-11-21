#!/usr/bin/env bash
# The iOS test-app build, run ON the Mac as one job (CL-MACLOCK, staff S91). `buildIosApp.sh build` uploads a snapshot of
# the source to `ksIos/build.noindex/jobs/<jobId>/src/` and starts this script from it:
#
#   iosBuildJob.sh <jobId> <content key> <app folder>
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
# Exit codes: the build's own; 143 on TERM or INT.
#
# Not here yet (S91, the follow-up PR): pruning old job folders, the check for a build group that outlived its wrapper,
# the 90 minute build limit and 3 hour wait limit, and the perl `d_flock` refusal. Until then a hung build holds the lock
# until someone stops it, and a `kill -9` of this process can let a second build start beside a live one.
set -euo pipefail

die() {
    echo "iosBuildJob: $*" >&2
    exit 1
}

job="${1:?a job id}"
key="${2:?a content key}"
app="${3:?an app folder}"
[[ "$job" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "'$job' is not a job id"
[[ "$key" =~ ^[A-Za-z0-9]+$ ]] || die "'$key' is not a content key"
[[ "$app" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] && [[ "/$app/" != *"/../"* ]] || die "'$app' is not a relative path of plain names"

root="$HOME/ksIos/build.noindex"
cd "$root"
mine="jobs/$job"
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

while :; do
    exec 9>> build.lock
    rc=0
    try_lock || rc=$?
    case "$rc" in
        0)
            [ "$(inode_of_fd9)" = "$(inode_of_path)" ] && break
            ;;
        1)
            say "waiting for the build lock: $(cat build.owner 2> /dev/null || echo 'holder unknown')"
            sleep 1
            ;;
        *) die 'could not take the build lock (flock failed for a reason other than "busy")' ;;
    esac
done

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
    print $o "job=$job pid=$wrapper pgid=$$ since=" . scalar(gmtime) . "\n";
    close($o);
    rename("$owner.tmp", $owner) or exit 2;
    exit 1 if getppid() != $wrapper;
    exec @cmd or exit 127;
' "$root/build.owner" "$job" "$$" bash -c "$steps" 9>&- &
child=$!

rc=0
wait "$child" || rc=$?
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
