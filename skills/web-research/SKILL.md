---
name: web-research
description: Research, inspect, extract, and enumerate web content with the devtools CLI. Use when an agent needs to search the web, search official docs, inspect a page before reading it, fetch readable content, extract links, or discover URLs from sitemaps.
---

# Web Research

Use this skill for web research and documentation discovery with `devtools`.

This skill covers the full web toolkit:

- broad web search
- docs-first search
- page inspection
- readable content extraction
- link discovery
- sitemap discovery

## When to use which command

- Need broad search results -> `devtools web search`
- Need official docs only -> `devtools web docs-search`
- Need metadata before reading content -> `devtools web inspect`
- Need readable page content -> `devtools web fetch`
- Need links to related pages -> `devtools web links`
- Need many candidate URLs quickly -> `devtools web sitemap`

## Recommended defaults

- Prefer `--json` when another tool or agent will read the result.
- Prefer `web docs-search` over general search when implementing against official APIs.
- Use `web inspect` before `web fetch` if you are unsure whether a page is relevant.
- Use `web links --same-origin` for lightweight docs traversal.
- Use `web sitemap --same-origin` when you need site URL discovery without crawling.

## Common commands

```bash
devtools web search "node.js 24 release notes"
devtools web docs-search nodejs.org/docs "fs watch" --json
devtools web inspect https://example.com/article --json
devtools web fetch https://example.com/article --format markdown
devtools web links https://example.com/docs/start --same-origin --json
devtools web sitemap https://example.com --same-origin --json
```

## References

- [Command reference](references/commands.md)
- [Workflow reference](references/workflows.md)
