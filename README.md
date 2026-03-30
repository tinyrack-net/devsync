<div align="center">

# Devsync

**Git-backed configuration sync for your development environment.**

[![CI](https://github.com/tinyrack-net/devsync/actions/workflows/ci.yml/badge.svg)](https://github.com/tinyrack-net/devsync/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@tinyrack/devsync)](https://www.npmjs.com/package/@tinyrack/devsync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org/)

[Documentation](https://devsync.tinyrack.net/en/) · [Getting Started](https://devsync.tinyrack.net/en/getting-started/) · [한국어](https://devsync.tinyrack.net/ko/)

</div>

---

Devsync is a cross-platform CLI that syncs the configuration files in your home directory across multiple devices using git.

Most dotfiles tools start from the repository and ask you to shape your local system around it. Devsync takes the opposite approach — your real config under `HOME` is the source of truth, and the git repository is just the sync artifact.

## Features

- **Track files and directories** under your home directory
- **Encrypt secrets** with [age](https://github.com/FiloSottile/age) before storing in the repo
- **Profiles** for syncing different subsets on different machines
- **Platform-specific paths** across Windows, macOS, Linux, and WSL
- **Dry-run previews** for both push and pull directions

## Quick Start

```bash
# Install
npm install -g @tinyrack/devsync

# Initialize
devsync init

# Track some configs
devsync track ~/.gitconfig
devsync track ~/.zshrc
devsync track ~/.ssh/config --mode secret

# Push local state to sync repo
devsync push
```

## Documentation

For detailed guides, command reference, and troubleshooting, visit the **[Devsync documentation site](https://devsync.tinyrack.net/en/)**.

## License

[MIT](LICENSE)
