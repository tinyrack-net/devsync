# devsync

`devsync` is a cross-platform CLI for managing the configuration files in your home directory with git and syncing them across multiple machines.

Instead of treating the repository as the source of truth, `devsync` treats your actual local config as the truth. You choose files and directories under `HOME`, `devsync` mirrors them into a git-backed sync repository, and later restores that repository onto another machine when you need it.

## 1. Purpose and how it differs

Most dotfiles tools start from the repository and ask you to shape your local machine around it.

`devsync` takes the opposite approach:

- Your real config under `HOME` is the source of truth.
- The git repository is a sync artifact, not the primary authoring location.
- `push` captures your current machine state into the repository.
- `pull` applies the repository back onto another machine.

That makes `devsync` a good fit when you want to:

- manage existing dotfiles and app configs without reorganizing your home directory,
- keep machine-specific config workflows intact,
- sync plain files and encrypted secrets together,
- use normal git remotes as the transport layer between PCs.

Core capabilities:

- track files and directories under your home directory,
- store synced artifacts in `~/.config/devsync/sync`,
- mark paths as `normal`, `secret`, or `ignore`,
- encrypt secret artifacts with `age`,
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

Track a few configs:

```bash
devsync add ~/.gitconfig
devsync add ~/.zshrc
devsync add ~/.config/mytool --secret
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
git status
git add .
git commit -m "Update synced config"
git push
```

On another machine, clone and restore from the same repo:

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

## 4. Detailed docs

### How tracking works

- You add files or directories that live under your home directory.
- `devsync` mirrors them into `~/.config/devsync/sync/files`.
- Plain artifacts are stored as-is.
- Secret artifacts are stored with the `.devsync.secret` suffix.

Storage layout:

- Sync repo: `~/.config/devsync/sync`
- Synced artifacts: `~/.config/devsync/sync/files`
- Default age identity: `$XDG_CONFIG_HOME/devsync/age/keys.txt`

### Sync modes

Each tracked path can use one of three modes:

- `normal`: store and restore plain content
- `secret`: encrypt before storing in the repo
- `ignore`: skip during push and pull

You can apply modes to tracked roots or nested paths inside tracked directories.

Examples:

```bash
devsync set secret ~/.config/mytool/token.json
devsync set ignore ~/.config/mytool/cache --recursive
devsync set normal ~/.config/mytool/public.json
```

### Common workflow

Check what changed:

```bash
devsync status
```

Capture local config into the repository:

```bash
devsync push
```

Restore repository state onto the machine:

```bash
devsync pull
```

Use dry runs when you want to review first:

```bash
devsync push --dry-run
devsync pull --dry-run
```

### Command reference

#### `init`

Create or connect the local sync repository.

```bash
devsync init
devsync init https://example.com/my-sync-repo.git
devsync init --identity "$XDG_CONFIG_HOME/devsync/age/keys.txt" --recipient age1...
```

#### `add`

Track a file or directory under your home directory.

```bash
devsync add ~/.gitconfig
devsync add ~/.config/mytool
devsync add ~/.config/mytool --secret
```

#### `set`

Change the sync mode for a tracked root, child path, or subtree.

```bash
devsync set secret ~/.config/mytool/token.json
devsync set ignore ~/.config/mytool/cache --recursive
```

#### `forget`

Remove a tracked path or nested override from config.

```bash
devsync forget ~/.gitconfig
devsync forget ~/.config/mytool
```

#### `list`

Show tracked entries, default modes, and overrides.

```bash
devsync list
```

#### `status`

Preview planned push and pull changes.

```bash
devsync status
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
```

#### `pull`

Apply repository state back onto the local machine.

```bash
devsync pull
devsync pull --dry-run
```

#### `cd`

Open the sync repository in your shell, or print its path.

```bash
devsync cd
devsync cd --print
```

For flag-level details, use built-in help:

```bash
devsync --help
devsync init --help
devsync add --help
devsync set --help
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
