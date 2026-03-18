import { createServer, type ServerResponse } from "node:http";

export type WebFixtureServer = Readonly<{
  baseUrl: string;
  close: () => Promise<void>;
}>;

const createArticleHtml = (baseUrl: string): string => {
  return `
    <html lang="en">
      <head>
        <title>Fixture Article</title>
        <meta name="description" content="Fixture description" />
        <meta property="og:title" content="Fixture OG Title" />
        <meta name="twitter:card" content="summary" />
        <link rel="canonical" href="/article" />
      </head>
      <body>
        <nav><a href="/ignored">Ignored</a></nav>
        <main class="content">
          <article>
            <h1>Primary heading</h1>
            <p>Alpha paragraph.</p>
            <div class="item">First item</div>
            <div class="item">Second item</div>
            <a href="/docs">Docs</a>
            <a href="/docs">Docs duplicate</a>
            <a href="https://external.example.com/path">External link</a>
            <pre><code class="language-ts">const answer = 42;</code></pre>
            <code class="language-bash">echo hello</code>
            <table>
              <caption>Options</caption>
              <thead>
                <tr><th>Name</th><th>Value</th></tr>
              </thead>
              <tbody>
                <tr><td>format</td><td>json</td></tr>
              </tbody>
            </table>
          </article>
        </main>
        <footer><a href="${baseUrl}/footer">Footer</a></footer>
      </body>
    </html>
  `;
};

const createRootHtml = (): string => {
  return `
    <html>
      <head>
        <title>Fixture Home</title>
        <meta name="description" content="Fixture home page" />
      </head>
      <body>
        <main>
          <a href="/docs">Docs</a>
          <a href="/article">Article</a>
          <a href="/loop">Loop</a>
          <a href="https://external.example.com/offsite">Offsite</a>
        </main>
      </body>
    </html>
  `;
};

const createDocsHtml = (): string => {
  return `
    <html>
      <head><title>Fixture Docs</title></head>
      <body>
        <main>
          <a href="/guide">Guide</a>
          <a href="/">Home</a>
        </main>
      </body>
    </html>
  `;
};

const createGuideHtml = (): string => {
  return `
    <html>
      <head><title>Fixture Guide</title></head>
      <body><main><a href="/article">Article</a></main></body>
    </html>
  `;
};

const createLoopHtml = (): string => {
  return `
    <html>
      <head><title>Fixture Loop</title></head>
      <body><main><a href="/">Home</a></main></body>
    </html>
  `;
};

const writeResponse = (
  serverResponse: ServerResponse,
  body: string,
  contentType: string,
  statusCode = 200,
): void => {
  serverResponse.statusCode = statusCode;
  serverResponse.setHeader("Content-Type", contentType);
  serverResponse.end(body);
};

export const startWebFixtureServer = async (): Promise<WebFixtureServer> => {
  const server = createServer((request, response) => {
    const host = request.headers.host ?? "127.0.0.1";
    const origin = `http://${host}`;
    const requestUrl = new URL(request.url ?? "/", origin);

    switch (requestUrl.pathname) {
      case "/":
        writeResponse(response, createRootHtml(), "text/html; charset=utf-8");
        return;
      case "/article":
        writeResponse(
          response,
          createArticleHtml(origin),
          "text/html; charset=utf-8",
        );
        return;
      case "/docs":
        writeResponse(response, createDocsHtml(), "text/html; charset=utf-8");
        return;
      case "/guide":
        writeResponse(response, createGuideHtml(), "text/html; charset=utf-8");
        return;
      case "/loop":
        writeResponse(response, createLoopHtml(), "text/html; charset=utf-8");
        return;
      case "/robots.txt":
        writeResponse(
          response,
          [
            "User-agent: *",
            "Allow: /",
            "Disallow: /private",
            `Sitemap: ${origin}/sitemap.xml`,
            "",
            "User-agent: devtools",
            "Allow: /",
            "Crawl-delay: 5",
          ].join("\n"),
          "text/plain; charset=utf-8",
        );
        return;
      case "/sitemap.xml":
        writeResponse(
          response,
          `<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/article</loc></url><url><loc>${origin}/docs</loc></url></urlset>`,
          "application/xml; charset=utf-8",
        );
        return;
      case "/sitemap-index.xml":
        writeResponse(
          response,
          `<?xml version="1.0" encoding="UTF-8"?><sitemapindex><sitemap><loc>${origin}/sitemap.xml</loc></sitemap></sitemapindex>`,
          "application/xml; charset=utf-8",
        );
        return;
      default:
        writeResponse(response, "not found", "text/plain; charset=utf-8", 404);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Failed to determine web fixture server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};
