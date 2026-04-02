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
      expressiveCode: {
        defaultProps: {
          frame: "none",
        },
      },
      title: "Devsync",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "Devsync",
      },
      favicon: "/favicon.svg",
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
        ja: {
          label: "日本語",
          lang: "ja",
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
            ja: "はじめに",
          },
          items: [{ slug: "intro" }, { slug: "getting-started" }],
        },
        {
          label: "Guides",
          translations: {
            ko: "가이드",
            ja: "ガイド",
          },
          items: [
            { slug: "guides/directory-structure" },
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
            ja: "コマンドリファレンス",
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
      ],
    }),
  ],
});
