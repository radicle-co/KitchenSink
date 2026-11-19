/**
 * The bash script that makes the environment every lane starts from, read back as one `env -0`. The stack's facts and
 * the ownership refusals come first, before any toolchain, key, seed or pool call, and the `stack:` line is the run's
 * first output. They also export the three host ports the runner reverses onto. `$1` is `localMaestro.sh` and `$2` the
 * repo root.
 */
export const BASE_ENVIRONMENT_SCRIPT =
    '. "$1" && cd "$2" && local_maestro_stack_env maestro:lanes >&2 && local_maestro_toolchain >&2 && ' +
    'local_maestro_load_clerk_keys >&2 && local_maestro_pin_aws && ' +
    'local_maestro_seed_env "$(local_maestro_state_dir)" && local_maestro_require_services >&2 && env -0';
