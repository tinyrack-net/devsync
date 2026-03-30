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
            ko: "가이드",
          },
          items: [{ slug: "getting-started" }],
        },
      ],
    }),
  ],
});
