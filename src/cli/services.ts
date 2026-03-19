import { fileURLToPath } from "node:url";

import {
  createSkillInstaller,
  createSkillUninstaller,
} from "#app/skills/install.ts";
import { createFetchWebPageReader } from "#app/web/fetch.ts";
import { createWebPageInspector } from "#app/web/inspect.ts";
import { createWebPageLinkReader } from "#app/web/links.ts";
import {
  createBraveSearchEngine,
  createSearchEngineRegistry,
} from "#app/web/search.ts";
import { createWebSitemapReader } from "#app/web/sitemap.ts";

const defaultSkillsDirectory = fileURLToPath(
  new URL("../../skills", import.meta.url),
);

export const createDefaultCliServices = () => {
  const { BRAVE_SEARCH_API_KEY: braveSearchApiKey } = process.env;

  return {
    createSearchEngineRegistry: (apiKeyOverride?: string) => {
      return createSearchEngineRegistry("brave", [
        createBraveSearchEngine({
          apiKey: apiKeyOverride ?? braveSearchApiKey,
          fetchImplementation: fetch,
        }),
      ]);
    },
    webPageReader: createFetchWebPageReader({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
    webPageInspector: createWebPageInspector({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
    webPageLinkReader: createWebPageLinkReader({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
    webSitemapReader: createWebSitemapReader({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
    skillInstaller: createSkillInstaller({
      skillsDirectory: defaultSkillsDirectory,
    }),
    skillUninstaller: createSkillUninstaller({
      skillsDirectory: defaultSkillsDirectory,
    }),
  };
};

export type CliServices = ReturnType<typeof createDefaultCliServices>;
