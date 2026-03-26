# devsync

`devsync` is a cross-platform CLI for managing the configuration files in your home directory with git and syncing them across multiple devices.

Instead of treating the repository as the source of truth, `devsync` treats your actual local config as the truth. You choose files and directories under `HOME`, `devsync` mirrors them into a git-backed sync repository, and later restores that repository onto another device when you need it.

## 1. Purpose and how it differs

Most dotfiles tools start from the repository and ask you to shape your local system around it.

`devsync` takes the opposite approach:

- Your real config under `HOME` is the source of truth.
- The git repository is a sync artifact, not the primary authoring location.
- `push` captures your current local state into the repository.
- `pull` applies the repository back onto another device.

That makes `devsync` a good fit when you want to:

- manage existing dotfiles and app configs without reorganizing your home directory,
- keep profile-specific config workflows intact,
- sync plain files and encrypted secrets together,
- use normal git remotes as the transport layer between PCs,
- handle platform-specific paths across Windows, macOS, and Linux.

Core capabilities:

- track files and directories under your home directory,
- store synced artifacts in `~/.config/devsync/sync`,
- mark paths as `normal`, `secret`, or `ignore`,
- encrypt secret artifacts with `age`,
- assign entries to profiles so different machines sync different subsets,
- support platform-specific local paths per entry,
- preview both directions with `status`, `push --dry-run`, and `pull --dry-run`.

## 2. Installation

Requirements:

- Node.js 24+
- npm
- git

Install globally:

```bash
npm install -g @tinyrack/devsync
devsync --help
```

Run without installing globally:

```bash
npx @tinyrack/devsync --help
```

Run from this checkout:

```bash
npm install
npm run start -- --help
```

The published package name is `@tinyrack/devsync`, and the installed command is `devsync`.

## 3. Quickstart

Initialize a local sync repository:

```bash
devsync init
```

Provide an existing age private key during setup:

```bash
devsync init --key AGE-SECRET-KEY-...
```

Track a few configs:

```bash
devsync track ~/.gitconfig
devsync track ~/.zshrc
devsync track ~/.config/mytool --mode secret
```

Review what would be captured:

```bash
devsync status
devsync push --dry-run
```

Write your current local config into the sync repository:

```bash
devsync push
```

Open the sync repository and publish it with git:

```bash
devsync cd
# inside the spawned shell
git add .
git commit -m "Update synced config"
git push
exit
```

On another device, clone and restore from the same repo:

```bash
devsync init https://example.com/my-sync-repo.git
devsync status
devsync pull --dry-run
devsync pull
```

Notes:

- `push` updates the sync repository contents only; it does not create git commits or push to a remote.
- `pull` updates local files only.
- Secret paths are stored encrypted in the repository and require the configured `age` identity to decrypt on restore.
- `init` prompts for an age private key when `--key` is omitted. Submit an empty response to generate a new identity automatically.
- Long-running commands such as `init`, `status`, `push`, `pull`, and multi-target `track` now stream progress to `stderr` while keeping the final summary on `stdout`.
- Use `--verbose` to show more detailed per-entry and per-file progress output.

## 4. Detailed docs

### How tracking works

- You track files or directories that live under your home directory.
- `devsync` mirrors them into `~/.config/devsync/sync/default/<repoPath>` for the default profile, or `~/.config/devsync/sync/<profile>/<repoPath>` for a named profile.
- Plain artifacts are stored as-is.
- Secret artifacts are stored with the `.devsync.secret` suffix.

Storage layout:

- Sync repo: `~/.config/devsync/sync`
- Default profile artifacts: `~/.config/devsync/sync/default/<repoPath>`
- Named profile artifacts: `~/.config/devsync/sync/<profile>/<repoPath>`
- Default age identity: `$XDG_CONFIG_HOME/devsync/age/keys.txt`

### Sync modes

Each tracked path can use one of three modes:

- `normal`: store and restore plain content
- `secret`: encrypt before storing in the repo
- `ignore`: skip during push and pull

Set modes when tracking, or update them later:

```bash
devsync track ~/.config/mytool --mode secret
devsync track ~/.config/mytool/cache --mode ignore
devsync track ~/.config/mytool/public.json --mode normal
```

Child entries inside a tracked directory inherit the parent mode unless explicitly overridden.

### Profiles

Profiles let you sync different subsets of entries on different machines. Each entry can be assigned to one or more profiles. When a profile is active, only entries assigned to that profile (plus entries with no profile restriction) are synced.

```bash
devsync track ~/.ssh/config --mode secret --profile work
devsync track ~/.gitconfig --profile work --profile personal
devsync track ~/.zshrc
devsync profile use work
devsync profile list
```

Key behaviors:

- Entries without `--profile` are synced on all profiles (including when no profile is active).
- Entries with `--profile` are only synced when one of the listed profiles is active.
- Pass `--profile ''` to clear profile restrictions from an entry.
- The `default` profile namespace is reserved for entries with no profile restriction.
- Commands like `push`, `pull`, and `status` accept `--profile` to override the active profile for a single operation.

### Platform-specific paths

Entries can specify different local paths per platform, so the same sync config works across Windows, macOS, Linux, and WSL:

Example `manifest.json`:

```json
{
  "version": 7,
  "age": {
    "identityFile": "$XDG_CONFIG_HOME/devsync/age/keys.txt",
    "recipients": ["age1example..."]
  },
  "entries": [
    {
      "kind": "file",
      "localPath": {
        "default": "~/.gitconfig",
        "win": "%USERPROFILE%/.gitconfig"
      },
      "mode": {
        "default": "normal"
      }
    },
    {
      "kind": "directory",
      "localPath": {
        "default": "~/.config/mytool",
        "win": "%APPDATA%/mytool"
      },
      "mode": {
        "default": "normal",
        "win": "ignore"
      },
      "profiles": ["work"]
    },
    {
      "kind": "file",
      "localPath": {
        "default": "~/.config/mytool/token.json"
      },
      "mode": {
        "default": "secret"
      },
      "profiles": ["work"]
    }
  ]
}
```

The `localPath` object supports `default`, `win`, `mac`, `linux`, and `wsl` keys. The `default` key is required. On WSL, `wsl` is used first, then `linux`, then `default`.
The `mode` object uses the same shape. `mode.default` is required, OS-specific keys are optional, and on WSL the fallback order is `wsl -> linux -> default`. An explicit child `mode` replaces the parent's full mode policy instead of merging platform overrides.

### Common workflow

Check what changed:

```bash
devsync status
```

Capture local config into the repository:

```bash
devsync push
```

Restore repository state locally:

```bash
devsync pull
```

Use dry runs when you want to review first:

```bash
devsync push --dry-run
devsync pull --dry-run
```

Override the active profile for a single operation:

```bash
devsync push --profile work
devsync pull --profile personal
devsync status --profile work
```

### Command reference

#### `init`

Create or connect the local sync repository.

```bash
devsync init
devsync init https://example.com/my-sync-repo.git
devsync init --identity "$XDG_CONFIG_HOME/devsync/age/keys.txt" --recipient age1...
```

#### `track`

Track a file or directory under your home directory.

```bash
devsync track ~/.gitconfig
devsync track ~/.gitconfig ~/.zshrc ~/.config/nvim
devsync track ~/.ssh/config --mode secret
devsync track ~/.ssh/config --mode secret --profile work
devsync track ~/.config/mytool/cache --mode ignore
```

If the target is already tracked, its mode is updated. Targets may also be repository paths inside a tracked directory to create child entries with a specific mode.

#### `untrack`

Remove a tracked entry from the sync config.

```bash
devsync untrack ~/.gitconfig
devsync untrack ~/.config/mytool
devsync untrack .config/mytool/token.json
```

This only updates the sync config; actual file changes happen on the next push or pull.

#### `status`

Preview planned push and pull changes.

```bash
devsync status
devsync status --profile work
```

#### `doctor`

Validate repo state, config, tracked paths, and secret setup.

```bash
devsync doctor
```

#### `push`

Write local state into the sync repository.

```bash
devsync push
devsync push --dry-run
devsync push --profile work
```

#### `pull`

Apply repository state back onto local paths.

```bash
devsync pull
devsync pull --dry-run
devsync pull --profile work
```

#### `profile list`

Show configured profiles and which one is active.

```bash
devsync profile list
```

#### `profile use`

Set or clear the active sync profile.

```bash
devsync profile use work
devsync profile use
```

Omit the profile name to clear the active profile.

#### `cd`

Launch a shell in the sync repository directory.

```bash
devsync cd
```

`devsync cd` opens a child shell rooted at the sync repository directory. Exit that shell to return to your original session.

For flag-level details, use built-in help:

```bash
devsync --help
devsync init --help
devsync track --help
```

## Development

Run the CLI locally:

```bash
npm run start -- --help
```

Watch mode:

```bash
npm run dev
```

Validation:

```bash
npm run typecheck
biome check .
npm run test
```

Or run everything at once:

```bash
npm run check
```

## Release

- CI runs `npm run check` on every push and pull request.
- npm publishing runs automatically for Git tags matching `v*.*.*`.
- The release workflow expects the pushed tag to match `package.json` `version`.

Typical release flow:

```bash
npm version patch
git push --follow-tags
```
