# devtools

A personal CLI tool for development-agent workflows.

`devtools` is a small Node.js + TypeScript command-line utility that makes web content easier to consume from scripts, terminals, and agent-driven workflows. It focuses on fast, structured web utilities that are useful when an AI coding agent needs to:

- search the web or restrict results to official docs
- fetch and normalize page content
- inspect page metadata before deciding what to read
- extract links for lightweight traversal
- discover URLs from sitemaps

## Features

- **Web search** powered by Brave Search
- **Docs-focused search** with site-restricted queries
- **Web page extraction** with readable article parsing
- **Page inspection** for metadata, canonical URLs, and headers
- **Link extraction** with same-origin filtering
- **Sitemap discovery and parsing** with nested sitemap support
- **Structured JSON output** across agent-oriented commands
- **Pi web-research skill template** with workflow-focused references
- **Skill installation** into Pi via symlinked local templates
- **Timeouts and deterministic output** for automation-friendly behavior
- **No build step for execution**: runs TypeScript directly with Node.js

## Requirements

- Node.js **24+**
- npm

## Installation

Install dependencies:

```bash
npm install
```

Run the CLI locally:

```bash
npm run start -- --help
```

For development with file watching:

```bash
npm run dev
```

If you want the `devtools` command available on your machine, you can link it locally:

```bash
npm link
```

## Configuration

`devtools` loads environment variables from `.env` in non-production environments.

Create a `.env` file in the project root when using web search:

```env
BRAVE_SEARCH_API_KEY=your_api_key_here
```

### Environment variables

- `BRAVE_SEARCH_API_KEY`: API key for the Brave Search engine
- `NODE_ENV`: standard Node environment value (`development`, `test`, or `production`)

## Usage

```bash
devtools <command>
```

Or without linking:

```bash
npm run start -- <command>
```

## Skill templates

The repository includes a Pi-compatible web research skill under `skills/web-research/`.

It also includes on-demand reference documents for command selection and workflows:

- `skills/web-research/SKILL.md`
- `skills/web-research/references/commands.md`
- `skills/web-research/references/workflows.md`

Install them into Pi's global skills directory:

```bash
devtools install skills pi
```

You can override the target directory, preview the installation, or replace existing links:

```bash
devtools install skills pi --target-dir ~/.pi/agent/skills
devtools install skills pi --dry-run
devtools install skills pi --force
```

If `PI_CODING_AGENT_DIR` is set, `devtools install skills pi` installs into:

```text
$PI_CODING_AGENT_DIR/skills
```

This command creates symlinks to the local skill directories so that Pi can discover and load them on demand.

## Commands

### `install skills`

Install bundled skill templates for a supported agent harness.

```bash
devtools install skills pi
```

Options:

- `--target-dir <path>`: override the destination directory
- `--dry-run`: preview changes without creating or replacing links
- `--force`: replace existing skill targets

Default destination behavior for `pi`:

- if `--target-dir` is set, use it
- else if `PI_CODING_AGENT_DIR` is set, use `$PI_CODING_AGENT_DIR/skills`
- else use `~/.pi/agent/skills`

### `web search`

Search the web with the configured search engine.

```bash
devtools web search <query>
```

Options:

- `-e, --engine <engine>`: search engine to use
- `-l, --limit <number>`: maximum number of results to return
- `-s, --site <site>`: restrict results to a hostname or docs path
- `-t, --timeout <ms>`: request timeout in milliseconds
- `--json`: print results as JSON
- `--api-key <key>`: override the configured API key

Examples:

```bash
devtools web search "node.js 24 release notes"
devtools web search "typescript erasable syntax" --limit 3
devtools web search "fetch api" --site nodejs.org/docs --json
```

Notes:

- The default engine is currently `brave`
- Brave search requires `BRAVE_SEARCH_API_KEY` unless you pass `--api-key`

### `web docs-search`

Search within a specific docs site or docs path.

```bash
devtools web docs-search <site> <query>
```

Examples:

```bash
devtools web docs-search nodejs.org/docs "fs watch"
devtools web docs-search https://vitest.dev/guide/ "mock timers" --json
```

### `web fetch`

Fetch a web page, extract its readable content, and print it in a structured format.

```bash
devtools web fetch <url>
```

Options:

- `-f, --format <format>`: one of `markdown`, `text`, `html`, `json`
- `-t, --timeout <ms>`: request timeout in milliseconds

Examples:

```bash
devtools web fetch https://example.com/article
devtools web fetch https://example.com/article --format text
devtools web fetch https://example.com/article --format json
devtools web fetch https://example.com/article --timeout 20000
```

### `web inspect`

Fetch a page and print metadata without article extraction.

```bash
devtools web inspect <url>
```

Examples:

```bash
devtools web inspect https://example.com/article
devtools web inspect https://example.com/article --json
```

### `web links`

Fetch a page and extract normalized links.

```bash
devtools web links <url>
```

Options:

- `--same-origin`: only include same-origin links
- `-t, --timeout <ms>`: request timeout in milliseconds
- `--json`: print links as JSON

Examples:

```bash
devtools web links https://example.com/article --json
devtools web links https://example.com/article --same-origin
```

### `web sitemap`

Read a sitemap directly or discover sitemap URLs for a site via `robots.txt` / `/sitemap.xml`.

```bash
devtools web sitemap <url>
```

Options:

- `--same-origin`: only include same-origin sitemap URLs
- `-c, --concurrency <number>`: maximum number of sitemap requests at once
- `-t, --timeout <ms>`: request timeout in milliseconds
- `--json`: print results as JSON

Examples:

```bash
devtools web sitemap https://example.com --json
devtools web sitemap https://example.com/sitemap.xml
devtools web sitemap https://example.com --same-origin --concurrency 2
```

## Example workflows

Search official docs only:

```bash
devtools web docs-search nodejs.org/docs "fs watch" --json
```

Inspect a page before fetching full content:

```bash
devtools web inspect https://example.com/post --json
```

Fetch a page as markdown for summarization or ingestion:

```bash
devtools web fetch https://example.com/post --format markdown
```

Extract same-origin links to discover related docs pages:

```bash
devtools web links https://example.com/docs/start --same-origin --json
```

Discover URLs from a sitemap for later ingestion:

```bash
devtools web sitemap https://example.com --same-origin --json
```

## Development

Useful commands:

```bash
npm run typecheck
biome check .
npm run test
npm run check
npm run check:fix
npm run format
```

## Project notes

- Runtime: Node.js with direct TypeScript execution
- Module system: ESM
- Type-checking: TypeScript in strict mode
- Linting/formatting: Biome
- Testing: Vitest

## Status

This is a personal tool and is intentionally small in scope. The current focus is making web search and web content extraction reliable for local development-agent use.
