import {
  type WebDocumentLoader,
  createFetchWebDocumentLoader,
  extractWebPageContent,
} from "./document.ts";
import {
  type FetchWebClientDependencies,
  createFetchWebClient,
} from "./fetch-client.ts";
import type { WebPageReader } from "./read.ts";

const withLoadedDocument = async <T>(
  loader: WebDocumentLoader,
  request: Parameters<WebPageReader["read"]>[0],
  callback: (
    loadedDocument: Awaited<ReturnType<WebDocumentLoader["load"]>>,
  ) => T,
): Promise<T> => {
  const loadedDocument = await loader.load(request);

  try {
    return callback(loadedDocument);
  } finally {
    loadedDocument.dom.window.close();
  }
};

export type FetchWebPageReaderDependencies = FetchWebClientDependencies;

export const createFetchWebPageReader = (
  dependencies: FetchWebPageReaderDependencies,
): WebPageReader => {
  const loader = createFetchWebDocumentLoader(
    createFetchWebClient(dependencies),
  );

  return {
    read: async (request) => {
      return withLoadedDocument(loader, request, (loadedDocument) => {
        return extractWebPageContent(loadedDocument);
      });
    },
  };
};
