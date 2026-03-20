# devsync

A personal CLI tool for git-backed configuration sync.

`devsync` is a Node.js + TypeScript command-line utility for managing a synced configuration repository under your XDG config directory. It tracks files and directories under `HOME`, stores plain and encrypted artifacts in a git-backed sync repo, and can push local state into that repo or pull the repo back onto the machine.

## Features

- Flat sync-focused CLI: `init`, `add`, `set`, `forget`, `push`, `pull`, `cd`
- Git-backed sync repository under `~/.config/devsync/sync`
- Age-encrypted secret file support
- Rule-based `normal`, `secret`, and `ignore` modes
- Direct TypeScript execution with Node.js 24+
- Shell autocomplete via oclif

## Requirements

- Node.js 24+
- npm
- git

## Installation

Install globally:

```bash
npm install -g @tinyrack/devsync
```

Run without installing globally:

```bash
npx @tinyrack/devsync --help
```

Run the CLI locally:

```bash
npm run start -- --help
```

For development with file watching:

```bash
npm run dev
```

The published package name is `@tinyrack/devsync`, but the installed command is still `devsync`.

If you want the `devsync` command available from this checkout during development:

```bash
npm link
```

## Storage Layout

- Sync repo: `~/.config/devsync/sync`
- Default age identity file: `$XDG_CONFIG_HOME/devsync/age/keys.txt`
- Tracked artifacts live under `~/.config/devsync/sync/files`
- Secret file artifacts use the suffix `.devsync.secret`, for example `token.json.devsync.secret`

## Usage

```bash
devsync <command>
```

Or without linking:

```bash
npm run start -- <command>
```

## Commands

### `init`

Initialize the git-backed sync directory.

```bash
devsync init
devsync init https://example.com/my-sync-repo.git
devsync init --identity "$XDG_CONFIG_HOME/devsync/age/keys.txt" --recipient age1...
```

### `add`

Track a local file or directory under your home directory.

```bash
devsync add ~/.gitconfig
devsync add ./.zshrc
devsync add ~/.config/mytool --secret
```

### `set`

Set mode for a tracked directory root, child file, or child subtree.

```bash
devsync set secret ~/.config/mytool/token.json
devsync set ignore ~/.config/mytool/cache --recursive
cd ~/.ssh && devsync set ignore known_hosts
devsync set normal .config/mytool/public.json
```

### `forget`

Remove a tracked local path or repository path from sync config.

```bash
devsync forget ~/.gitconfig
cd ~/mytool && devsync forget ./settings.json
devsync forget .config/mytool
```

### `push`

Mirror local config into the sync repository.

```bash
devsync push
devsync push --dry-run
```

### `pull`

Apply the sync repository to local config paths.

```bash
devsync pull
devsync pull --dry-run
```

### `cd`

Print the sync directory in non-interactive mode, or open a shell there in interactive mode.

```bash
devsync cd
devsync cd --print
```

## Development

Validation commands:

```bash
npm run typecheck
biome check .
npm run test
```

Or run the full validation sequence:

```bash
npm run check
```
