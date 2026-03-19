import InstallSkills from "#app/cli/commands/install/skills.ts";
import UninstallSkills from "#app/cli/commands/uninstall/skills.ts";
import WebDocsSearch from "#app/cli/commands/web/docs-search.ts";
import WebFetch from "#app/cli/commands/web/fetch.ts";
import WebInspect from "#app/cli/commands/web/inspect.ts";
import WebLinks from "#app/cli/commands/web/links.ts";
import WebSearch from "#app/cli/commands/web/search.ts";
import WebSitemap from "#app/cli/commands/web/sitemap.ts";

export const COMMANDS = {
  "install:skills": InstallSkills,
  "uninstall:skills": UninstallSkills,
  "web:docs-search": WebDocsSearch,
  "web:fetch": WebFetch,
  "web:inspect": WebInspect,
  "web:links": WebLinks,
  "web:search": WebSearch,
  "web:sitemap": WebSitemap,
};
