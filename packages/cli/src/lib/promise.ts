/**
 * Limits the number of concurrent asynchronous operations.
 *
 * @param concurrency - The maximum number of concurrent operations.
 * @param items - The items to process.
 * @param mapper - The mapping function that returns a promise.
 * @returns A promise that resolves to an array of the results.
 */
export const limitConcurrency = async <T, R>(
  concurrency: number,
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => {
      return worker();
    },
  );

  await Promise.all(workers);

  return results;
};
