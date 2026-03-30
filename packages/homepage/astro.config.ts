import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import type { AstroUserConfig } from "astro";
import { defineConfig } from "astro/config";
import starlightThemeBlack from "starlight-theme-black";

export default defineConfig({
  site: "https://devsync.tinyrack.net",
  trailingSlash: "always",
  redirects: {
    "/": "/en/",
  },
  vite: {
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
    plugins: [tailwindcss()] as NonNullable<AstroUserConfig["vite"]>["plugins"],
  },
  integrations: [
    starlight({
      title: "devsync",
      description:
        "Git-backed configuration sync for your development environment.",
      defaultLocale: "en",
      locales: {
        en: {
          label: "English",
          lang: "en",
        },
        ko: {
          label: "한국어",
          lang: "ko",
        },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/tinyrack-net/devsync",
        },
      ],
      plugins: [
        starlightThemeBlack({
          footerText:
            "devsync · MIT License · [GitHub](https://github.com/tinyrack-net/devsync)",
        }),
      ],
      customCss: ["./src/styles/tailwind.css"],
      components: {
        Hero: "./src/components/OverrideHero.astro",
      },
      sidebar: [
        {
          label: "Guide",
          translations: {
            ko: "소개",
          },
          items: [
            { slug: "intro" },
            { slug: "getting-started" },
          ],
        },
        {
          label: "Guides",
          translations: {
            ko: "가이드",
          },
          items: [
            { slug: "guides/how-it-works" },
            { slug: "guides/sync-modes" },
            { slug: "guides/tracking-files" },
            { slug: "guides/syncing-secrets" },
            { slug: "guides/profiles" },
            { slug: "guides/multi-device-workflow" },
            { slug: "guides/platform-specific-paths" },
            { slug: "guides/shell-autocomplete" },
          ],
        },
        {
          label: "Command Reference",
          translations: {
            ko: "명령어 레퍼런스",
          },
          items: [
            { slug: "reference/init" },
            { slug: "reference/track" },
            { slug: "reference/untrack" },
            { slug: "reference/status" },
            { slug: "reference/push" },
            { slug: "reference/pull" },
            { slug: "reference/doctor" },
            { slug: "reference/cd" },
            { slug: "reference/profile" },
            { slug: "reference/autocomplete" },
          ],
        },
        {
          label: "Troubleshooting",
          translations: {
            ko: "문제 해결",
          },
          items: [
            { slug: "troubleshooting" },
          ],
        },
      ],
    }),
  ],
});
