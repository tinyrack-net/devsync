# Web Command Reference

This document explains how to use each `devtools web` command from an agent workflow.

## General guidance

- Prefer `--json` when the output will be parsed by another tool or reused in a later step.
- Increase `--timeout <ms>` for slower sites or long-running requests.
- Prefer official docs with `docs-search` when answering implementation questions.
- For multi-step research, start narrow:
  1. `docs-search` or `search`
  2. `inspect`
  3. `fetch`
  4. `links` or `sitemap`

---

## `devtools web search`

Search the general web.

```bash
devtools web search "<query>"
```

### Use when

- you do not yet know the best source
- you need release notes, blog posts, issues, or mixed sources
- you want to combine general search with `--site`

### Useful options

- `--site <site>` restricts results to a hostname or docs path
- `--limit <number>` reduces noise
- `--json` produces structured output
- `--timeout <ms>` bounds request time
- `--api-key <key>` overrides `BRAVE_SEARCH_API_KEY`

### Examples

```bash
devtools web search "node.js permission model"
devtools web search "fetch api" --site nodejs.org/docs --json
devtools web search "vitest snapshot update" --limit 3
```

---

## `devtools web docs-search`

Search within a specific docs site or docs path.

```bash
devtools web docs-search <site> "<query>"
```

### Use when

- you already know the official docs site
- you want fewer low-quality or off-topic results
- you need implementation references for code changes

### Good inputs for `<site>`

- `nodejs.org/docs`
- `typescriptlang.org/docs`
- `https://vitest.dev/guide/`

### Examples

```bash
devtools web docs-search nodejs.org/docs "fs watch"
devtools web docs-search typescriptlang.org/docs "satisfies operator" --json
devtools web docs-search https://vitest.dev/guide/ "mock timers"
```

---

## `devtools web inspect`

Fetch metadata without article extraction.

```bash
devtools web inspect <url>
```

### Use when

- you want to validate the page before fetching content
- you need title, canonical URL, content type, or robots metadata
- you want to detect whether the page looks relevant

### Typical fields

- `requestedUrl`
- `finalUrl`
- `canonicalUrl`
- `statusCode`
- `contentType`
- `contentLength`
- `title`
- `description`
- `robots`

### Examples

```bash
devtools web inspect https://example.com/article --json
devtools web inspect https://example.com/article --timeout 5000
```

---

## `devtools web fetch`

Fetch a page and extract readable content.

```bash
devtools web fetch <url>
```

### Use when

- you want the article or main content, not raw HTML
- you need markdown or text for summarization
- you want structured page output for later use

### Output formats

- `markdown` - best default for LLM-friendly reading
- `text` - useful for plain terminal output
- `html` - readable extracted HTML, not raw source
- `json` - full structured result with metadata and content

### Examples

```bash
devtools web fetch https://example.com/article
devtools web fetch https://example.com/article --format markdown
devtools web fetch https://example.com/article --format json
```

---

## `devtools web links`

Extract normalized links from a page.

```bash
devtools web links <url>
```

### Use when

- you need related pages from a docs page or landing page
- you want to enumerate local navigation without full crawling
- you need a structured link inventory

### Link kinds

- `same-origin`
- `fragment`
- `external`

### Useful options

- `--same-origin` focuses on local site traversal
- `--json` gives structured grouped links

### Examples

```bash
devtools web links https://example.com/docs/start --same-origin --json
devtools web links https://example.com/article --json
```

---

## `devtools web sitemap`

Discover or parse sitemap documents.

```bash
devtools web sitemap <url>
```

### Use when

- you need many candidate URLs quickly
- you are working with docs sites, changelogs, blogs, or API references
- you want URL discovery without page crawling

### Behavior

- if `<url>` already points to XML, the command reads that sitemap directly
- otherwise it tries `robots.txt`
- if no sitemap is found there, it falls back to `/sitemap.xml`

### Useful options

- `--same-origin` keeps results scoped to the site
- `--concurrency <number>` controls nested sitemap reads
- `--json` is best for downstream automation

### Examples

```bash
devtools web sitemap https://example.com --same-origin --json
devtools web sitemap https://example.com/sitemap.xml
devtools web sitemap https://example.com --concurrency 2
```
