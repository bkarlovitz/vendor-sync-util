# vendor-sync-util — Design

## Goal

Give coding agents access to the real source code of external dependencies, version-matched to the project, without bloating the project's git repo with vendored library source.

## Mental model

`repos/` is to vendored reference source as `node_modules/` is to installed dependencies: declared in a committed config file, materialized locally by a script, gitignored, regenerated on demand.

## Convention

- All vendored repos live under `repos/` at the project root.
- `repos/` is always gitignored.
- A `vendor.config.json` at the project root declares what gets vendored.
- The script `sync.ts` reads the config and populates `repos/`.

## Scope

- TypeScript / JavaScript projects.
- Public GitHub repositories.
- Other ecosystems and private repos are out of scope of this realization of the utility.

## Config file

`vendor.config.json` lives at the project root.

| Field | Required | Description |
|---|---|---|
| `outDir` | yes | Directory where vendored repos live. Conventionally `"repos"`. |
| `entries[].package` | yes | The npm package name. Used for cross-referencing with `package.json`. |
| `entries[].version` | yes | The npm semver version this entry corresponds to. Informational. |
| `entries[].repo` | yes | Full git URL of the upstream repository. |
| `entries[].ref` | yes | Exact git ref to check out — tag, branch, or SHA. Passed to `git clone --branch`. |
| `entries[].dir` | yes | Subdirectory name under `outDir`. Usually matches `package`. |

There is no lockfile, no version inference from `package.json`, and no tag-pattern guessing. The config is fully explicit; the ref you write is the ref that gets cloned.

## Commands

### `sync`

Reconciles `repos/` against the config.

For each entry:

1. If `repos/<dir>` does not exist, then clone at the specified ref.
2. If `repos/<dir>` exists but is at a different ref, then delete and re-clone.
3. If `repos/<dir>` exists and matches the ref, then leave alone.

After processing entries: delete any directories under `repos/` not declared in the config (orphan cleanup).

Clone invocation:

```bash
git clone --depth 1 --single-branch --no-tags \
  --branch <ref> <repo> <outDir>/<dir>
```

`--depth 1` keeps the clone to a single snapshot. `--single-branch` and `--no-tags` minimize what's fetched.

The configured ref is written to `<target>/.vendor-ref` after a successful clone. On subsequent runs, that file is read and compared as a string to determine whether a re-clone is needed. This avoids any `git rev-parse` nonsense with shallow clones.

### `status`

Diagnostic. For each entry print package, version, ref, whether `repos/<dir>` is present, and whether the present ref matches the config. Orphan directories are listed at the bottom.

## Project setup

The script does not modify project config. Setup is documented and manual:

- Add `repos/` to `.gitignore`.
- Add `"repos"` to `tsconfig.json` `exclude`.
- Add `repos/**` excludes to `.vscode/settings.json` for:
  - `typescript.preferences.autoImportFileExcludePatterns`
  - `javascript.preferences.autoImportFileExcludePatterns`
  - `files.exclude`
  - `files.watcherExclude`
  - `search.exclude`
- Add a `sync-vendors` script to `package.json` that runs `bun tools/vendor/sync.ts sync` (or wherever the user dropped the script).
- Add a vendored-repos section to `CLAUDE.md` or `AGENTS.md` telling the agent how to use `repos/`.

## Out of scope

- Non-npm ecosystems (Go, Rust, Python, etc.).
- Private or non-GitHub sources.
- Automatic version resolution from `package.json` or lockfiles.
- Partial / sparse vendoring of monorepo subdirectories.
- Pushing changes back upstream.
- Managing `tsconfig`, `.vscode`, or `AGENTS.md` files automatically.
