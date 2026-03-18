# Web Workflow Reference

This document describes practical ways to combine the `devtools web` commands.

## Workflow 1: Find the right official docs page

Goal: answer an implementation question using official references.

### Steps

1. Search the docs site.
2. Inspect the best candidate.
3. Fetch the content.

### Example

```bash
devtools web docs-search nodejs.org/docs "fs watch" --json
devtools web inspect https://nodejs.org/docs/latest/api/fs.html --json
devtools web fetch https://nodejs.org/docs/latest/api/fs.html --format markdown
```

### Notes

- Prefer `docs-search` over general search for code-facing questions.
- If several pages look relevant, inspect each before fetching full content.

---

## Workflow 2: Start from broad search, then narrow

Goal: research a topic when you do not yet know the best source.

### Steps

1. Run general search.
2. Restrict the search to an official site if one becomes obvious.
3. Inspect and fetch the best result.

### Example

```bash
devtools web search "vitest mock timers"
devtools web search "vitest mock timers" --site vitest.dev --json
devtools web inspect https://vitest.dev/guide/mocking/timers --json
devtools web fetch https://vitest.dev/guide/mocking/timers --format markdown
```

---

## Workflow 3: Traverse a docs section from a known page

Goal: find nearby pages that may contain the missing detail.

### Steps

1. Inspect the starting page.
2. Extract same-origin links.
3. Fetch the most promising links.

### Example

```bash
devtools web inspect https://example.com/docs/start --json
devtools web links https://example.com/docs/start --same-origin --json
devtools web fetch https://example.com/docs/advanced --format markdown
```

### Notes

- `links` is lighter than a crawler and works well when you already have a strong starting point.
- Use link text and URL paths to prioritize which pages to read next.

---

## Workflow 4: Enumerate a whole docs site quickly

Goal: discover many candidate URLs for later reading.

### Steps

1. Read the site sitemap.
2. Filter candidate URLs outside the CLI if needed.
3. Fetch selected pages.

### Example

```bash
devtools web sitemap https://example.com --same-origin --json
devtools web fetch https://example.com/docs/getting-started --format markdown
devtools web fetch https://example.com/docs/configuration --format markdown
```

### Notes

- Prefer `sitemap` over `links` when you need broad URL coverage.
- Prefer `links` over `sitemap` when you want pages related to a specific starting document.

---

## Workflow 5: Build a compact research trail for an agent

Goal: produce structured outputs that can be chained together.

### Recommended pattern

1. Search with `--json`
2. Inspect with `--json`
3. Fetch with `--format json`
4. Discover related pages with `links` or `sitemap`

### Example

```bash
devtools web docs-search typescriptlang.org/docs "template literal types" --json
devtools web inspect https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html --json
devtools web fetch https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html --format json
devtools web links https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html --same-origin --json
```

### Why this works

- outputs stay structured
- decisions can be made step by step
- the agent can avoid fetching low-value pages too early

---

## Choosing between `links` and `sitemap`

Use `links` when:
- you have a good entry page
- you want local neighbors
- you care about on-page navigation structure

Use `sitemap` when:
- you want broad discovery
- you need many URLs quickly
- the site is documentation-heavy and likely exposes a sitemap

---

## Suggested defaults for agent workflows

- search: `--json`
- docs search: `--json`
- inspect: `--json`
- fetch: `--format markdown` or `--format json`
- links: `--same-origin --json`
- sitemap: `--same-origin --json`
