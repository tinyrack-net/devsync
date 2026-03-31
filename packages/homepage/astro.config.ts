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
      host: "0.0.0.0",
      allowedHosts: true,
    },
    plugins: [tailwindcss()] as NonNullable<AstroUserConfig["vite"]>["plugins"],
  },
  integrations: [
    starlight({
      title: "Devsync",
      description:
        "Git-backed configuration sync for your development environment.",
      head: [
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary" },
        },
        {
          tag: "meta",
          attrs: { property: "og:site_name", content: "Devsync" },
        },
      ],
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
            "Devsync · MIT License · [GitHub](https://github.com/tinyrack-net/devsync)",
        }),
      ],
      customCss: ["./src/styles/tailwind.css"],
      components: {
        Hero: "./src/components/OverrideHero.astro",
      },
      sidebar: [
        {
          label: "Overview",
          translations: {
            ko: "시작하기",
          },
          items: [{ slug: "intro" }, { slug: "getting-started" }],
        },
        {
          label: "Guides",
          translations: {
            ko: "가이드",
          },
          items: [
            { slug: "guides/tracking-files" },
            { slug: "guides/sync-modes" },
            { slug: "guides/syncing-secrets" },
            { slug: "guides/profiles" },
            { slug: "guides/platform-specific-paths" },
            { slug: "guides/multi-device-workflow" },
            { slug: "guides/how-it-works" },
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
            { slug: "reference/push" },
            { slug: "reference/pull" },
            { slug: "reference/status" },
            { slug: "reference/untrack" },
            { slug: "reference/cd" },
            { slug: "reference/profile" },
            { slug: "reference/doctor" },
            { slug: "reference/autocomplete" },
          ],
        },
        {
          label: "Troubleshooting",
          translations: {
            ko: "문제 해결",
          },
          items: [{ slug: "troubleshooting" }],
        },
      ],
    }),
  ],
});
