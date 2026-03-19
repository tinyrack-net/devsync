import InstallSkills from "#app/cli/commands/install/skills.ts";
import SyncAdd from "#app/cli/commands/sync/add.ts";
import SyncCd from "#app/cli/commands/sync/cd.ts";
import SyncForget from "#app/cli/commands/sync/forget.ts";
import SyncInit from "#app/cli/commands/sync/init.ts";
import SyncPull from "#app/cli/commands/sync/pull.ts";
import SyncPush from "#app/cli/commands/sync/push.ts";
import UninstallSkills from "#app/cli/commands/uninstall/skills.ts";
import WebDocsSearch from "#app/cli/commands/web/docs-search.ts";
import WebFetch from "#app/cli/commands/web/fetch.ts";
import WebInspect from "#app/cli/commands/web/inspect.ts";
import WebLinks from "#app/cli/commands/web/links.ts";
import WebSearch from "#app/cli/commands/web/search.ts";
import WebSitemap from "#app/cli/commands/web/sitemap.ts";

export const COMMANDS = {
  "install:skills": InstallSkills,
  "sync:add": SyncAdd,
  "sync:cd": SyncCd,
  "sync:forget": SyncForget,
  "sync:init": SyncInit,
  "sync:pull": SyncPull,
  "sync:push": SyncPush,
  "uninstall:skills": UninstallSkills,
  "web:docs-search": WebDocsSearch,
  "web:fetch": WebFetch,
  "web:inspect": WebInspect,
  "web:links": WebLinks,
  "web:search": WebSearch,
  "web:sitemap": WebSitemap,
};
