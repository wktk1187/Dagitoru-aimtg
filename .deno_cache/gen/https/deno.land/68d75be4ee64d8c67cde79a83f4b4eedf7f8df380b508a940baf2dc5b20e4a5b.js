// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
export const ERROR_WHILE_MAPPING_MESSAGE = "Threw while mapping.";
/**
 * pooledMap transforms values from an (async) iterable into another async
 * iterable. The transforms are done concurrently, with a max concurrency
 * defined by the poolLimit.
 *
 * If an error is thrown from `iterableFn`, no new transformations will begin.
 * All currently executing transformations are allowed to finish and still
 * yielded on success. After that, the rejections among them are gathered and
 * thrown by the iterator in an `AggregateError`.
 *
 * @example
 * ```typescript
 * import { pooledMap } from "https://deno.land/std@$STD_VERSION/async/pool.ts";
 *
 * const results = pooledMap(
 *   2,
 *   [1, 2, 3],
 *   (i) => new Promise((r) => setTimeout(() => r(i), 1000)),
 * );
 *
 * for await (const value of results) {
 *   // ...
 * }
 * ```
 *
 * @param poolLimit The maximum count of items being processed concurrently.
 * @param array The input array for mapping.
 * @param iteratorFn The function to call for every item of the array.
 */ export function pooledMap(poolLimit, array, iteratorFn) {
  // Create the async iterable that is returned from this function.
  const res = new TransformStream({
    async transform (p, controller) {
      try {
        const s = await p;
        controller.enqueue(s);
      } catch (e) {
        if (e instanceof AggregateError && e.message == ERROR_WHILE_MAPPING_MESSAGE) {
          controller.error(e);
        }
      }
    }
  });
  // Start processing items from the iterator
  (async ()=>{
    const writer = res.writable.getWriter();
    const executing = [];
    try {
      for await (const item of array){
        const p = Promise.resolve().then(()=>iteratorFn(item));
        // Only write on success. If we `writer.write()` a rejected promise,
        // that will end the iteration. We don't want that yet. Instead let it
        // fail the race, taking us to the catch block where all currently
        // executing jobs are allowed to finish and all rejections among them
        // can be reported together.
        writer.write(p);
        const e = p.then(()=>executing.splice(executing.indexOf(e), 1));
        executing.push(e);
        if (executing.length >= poolLimit) {
          await Promise.race(executing);
        }
      }
      // Wait until all ongoing events have processed, then close the writer.
      await Promise.all(executing);
      writer.close();
    } catch  {
      const errors = [];
      for (const result of (await Promise.allSettled(executing))){
        if (result.status == "rejected") {
          errors.push(result.reason);
        }
      }
      writer.write(Promise.reject(new AggregateError(errors, ERROR_WHILE_MAPPING_MESSAGE))).catch(()=>{});
    }
  })();
  return res.readable[Symbol.asyncIterator]();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjE3Ny4wL2FzeW5jL3Bvb2wudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IDIwMTgtMjAyMyB0aGUgRGVubyBhdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLiBNSVQgbGljZW5zZS5cblxuZXhwb3J0IGNvbnN0IEVSUk9SX1dISUxFX01BUFBJTkdfTUVTU0FHRSA9IFwiVGhyZXcgd2hpbGUgbWFwcGluZy5cIjtcblxuLyoqXG4gKiBwb29sZWRNYXAgdHJhbnNmb3JtcyB2YWx1ZXMgZnJvbSBhbiAoYXN5bmMpIGl0ZXJhYmxlIGludG8gYW5vdGhlciBhc3luY1xuICogaXRlcmFibGUuIFRoZSB0cmFuc2Zvcm1zIGFyZSBkb25lIGNvbmN1cnJlbnRseSwgd2l0aCBhIG1heCBjb25jdXJyZW5jeVxuICogZGVmaW5lZCBieSB0aGUgcG9vbExpbWl0LlxuICpcbiAqIElmIGFuIGVycm9yIGlzIHRocm93biBmcm9tIGBpdGVyYWJsZUZuYCwgbm8gbmV3IHRyYW5zZm9ybWF0aW9ucyB3aWxsIGJlZ2luLlxuICogQWxsIGN1cnJlbnRseSBleGVjdXRpbmcgdHJhbnNmb3JtYXRpb25zIGFyZSBhbGxvd2VkIHRvIGZpbmlzaCBhbmQgc3RpbGxcbiAqIHlpZWxkZWQgb24gc3VjY2Vzcy4gQWZ0ZXIgdGhhdCwgdGhlIHJlamVjdGlvbnMgYW1vbmcgdGhlbSBhcmUgZ2F0aGVyZWQgYW5kXG4gKiB0aHJvd24gYnkgdGhlIGl0ZXJhdG9yIGluIGFuIGBBZ2dyZWdhdGVFcnJvcmAuXG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHBvb2xlZE1hcCB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2FzeW5jL3Bvb2wudHNcIjtcbiAqXG4gKiBjb25zdCByZXN1bHRzID0gcG9vbGVkTWFwKFxuICogICAyLFxuICogICBbMSwgMiwgM10sXG4gKiAgIChpKSA9PiBuZXcgUHJvbWlzZSgocikgPT4gc2V0VGltZW91dCgoKSA9PiByKGkpLCAxMDAwKSksXG4gKiApO1xuICpcbiAqIGZvciBhd2FpdCAoY29uc3QgdmFsdWUgb2YgcmVzdWx0cykge1xuICogICAvLyAuLi5cbiAqIH1cbiAqIGBgYFxuICpcbiAqIEBwYXJhbSBwb29sTGltaXQgVGhlIG1heGltdW0gY291bnQgb2YgaXRlbXMgYmVpbmcgcHJvY2Vzc2VkIGNvbmN1cnJlbnRseS5cbiAqIEBwYXJhbSBhcnJheSBUaGUgaW5wdXQgYXJyYXkgZm9yIG1hcHBpbmcuXG4gKiBAcGFyYW0gaXRlcmF0b3JGbiBUaGUgZnVuY3Rpb24gdG8gY2FsbCBmb3IgZXZlcnkgaXRlbSBvZiB0aGUgYXJyYXkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb29sZWRNYXA8VCwgUj4oXG4gIHBvb2xMaW1pdDogbnVtYmVyLFxuICBhcnJheTogSXRlcmFibGU8VD4gfCBBc3luY0l0ZXJhYmxlPFQ+LFxuICBpdGVyYXRvckZuOiAoZGF0YTogVCkgPT4gUHJvbWlzZTxSPixcbik6IEFzeW5jSXRlcmFibGVJdGVyYXRvcjxSPiB7XG4gIC8vIENyZWF0ZSB0aGUgYXN5bmMgaXRlcmFibGUgdGhhdCBpcyByZXR1cm5lZCBmcm9tIHRoaXMgZnVuY3Rpb24uXG4gIGNvbnN0IHJlcyA9IG5ldyBUcmFuc2Zvcm1TdHJlYW08UHJvbWlzZTxSPiwgUj4oe1xuICAgIGFzeW5jIHRyYW5zZm9ybShcbiAgICAgIHA6IFByb21pc2U8Uj4sXG4gICAgICBjb250cm9sbGVyOiBUcmFuc2Zvcm1TdHJlYW1EZWZhdWx0Q29udHJvbGxlcjxSPixcbiAgICApIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHMgPSBhd2FpdCBwO1xuICAgICAgICBjb250cm9sbGVyLmVucXVldWUocyk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBlIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IgJiZcbiAgICAgICAgICBlLm1lc3NhZ2UgPT0gRVJST1JfV0hJTEVfTUFQUElOR19NRVNTQUdFXG4gICAgICAgICkge1xuICAgICAgICAgIGNvbnRyb2xsZXIuZXJyb3IoZSBhcyB1bmtub3duKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG4gIH0pO1xuICAvLyBTdGFydCBwcm9jZXNzaW5nIGl0ZW1zIGZyb20gdGhlIGl0ZXJhdG9yXG4gIChhc3luYyAoKSA9PiB7XG4gICAgY29uc3Qgd3JpdGVyID0gcmVzLndyaXRhYmxlLmdldFdyaXRlcigpO1xuICAgIGNvbnN0IGV4ZWN1dGluZzogQXJyYXk8UHJvbWlzZTx1bmtub3duPj4gPSBbXTtcbiAgICB0cnkge1xuICAgICAgZm9yIGF3YWl0IChjb25zdCBpdGVtIG9mIGFycmF5KSB7XG4gICAgICAgIGNvbnN0IHAgPSBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IGl0ZXJhdG9yRm4oaXRlbSkpO1xuICAgICAgICAvLyBPbmx5IHdyaXRlIG9uIHN1Y2Nlc3MuIElmIHdlIGB3cml0ZXIud3JpdGUoKWAgYSByZWplY3RlZCBwcm9taXNlLFxuICAgICAgICAvLyB0aGF0IHdpbGwgZW5kIHRoZSBpdGVyYXRpb24uIFdlIGRvbid0IHdhbnQgdGhhdCB5ZXQuIEluc3RlYWQgbGV0IGl0XG4gICAgICAgIC8vIGZhaWwgdGhlIHJhY2UsIHRha2luZyB1cyB0byB0aGUgY2F0Y2ggYmxvY2sgd2hlcmUgYWxsIGN1cnJlbnRseVxuICAgICAgICAvLyBleGVjdXRpbmcgam9icyBhcmUgYWxsb3dlZCB0byBmaW5pc2ggYW5kIGFsbCByZWplY3Rpb25zIGFtb25nIHRoZW1cbiAgICAgICAgLy8gY2FuIGJlIHJlcG9ydGVkIHRvZ2V0aGVyLlxuICAgICAgICB3cml0ZXIud3JpdGUocCk7XG4gICAgICAgIGNvbnN0IGU6IFByb21pc2U8dW5rbm93bj4gPSBwLnRoZW4oKCkgPT5cbiAgICAgICAgICBleGVjdXRpbmcuc3BsaWNlKGV4ZWN1dGluZy5pbmRleE9mKGUpLCAxKVxuICAgICAgICApO1xuICAgICAgICBleGVjdXRpbmcucHVzaChlKTtcbiAgICAgICAgaWYgKGV4ZWN1dGluZy5sZW5ndGggPj0gcG9vbExpbWl0KSB7XG4gICAgICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKGV4ZWN1dGluZyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFdhaXQgdW50aWwgYWxsIG9uZ29pbmcgZXZlbnRzIGhhdmUgcHJvY2Vzc2VkLCB0aGVuIGNsb3NlIHRoZSB3cml0ZXIuXG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChleGVjdXRpbmcpO1xuICAgICAgd3JpdGVyLmNsb3NlKCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICBjb25zdCBlcnJvcnMgPSBbXTtcbiAgICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChleGVjdXRpbmcpKSB7XG4gICAgICAgIGlmIChyZXN1bHQuc3RhdHVzID09IFwicmVqZWN0ZWRcIikge1xuICAgICAgICAgIGVycm9ycy5wdXNoKHJlc3VsdC5yZWFzb24pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB3cml0ZXIud3JpdGUoUHJvbWlzZS5yZWplY3QoXG4gICAgICAgIG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIEVSUk9SX1dISUxFX01BUFBJTkdfTUVTU0FHRSksXG4gICAgICApKS5jYXRjaCgoKSA9PiB7fSk7XG4gICAgfVxuICB9KSgpO1xuICByZXR1cm4gcmVzLnJlYWRhYmxlW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSgpO1xufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLDBFQUEwRTtBQUUxRSxPQUFPLE1BQU0sOEJBQThCLHVCQUF1QjtBQUVsRTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQTRCQyxHQUNELE9BQU8sU0FBUyxVQUNkLFNBQWlCLEVBQ2pCLEtBQXFDLEVBQ3JDLFVBQW1DO0VBRW5DLGlFQUFpRTtFQUNqRSxNQUFNLE1BQU0sSUFBSSxnQkFBK0I7SUFDN0MsTUFBTSxXQUNKLENBQWEsRUFDYixVQUErQztNQUUvQyxJQUFJO1FBQ0YsTUFBTSxJQUFJLE1BQU07UUFDaEIsV0FBVyxPQUFPLENBQUM7TUFDckIsRUFBRSxPQUFPLEdBQUc7UUFDVixJQUNFLGFBQWEsa0JBQ2IsRUFBRSxPQUFPLElBQUksNkJBQ2I7VUFDQSxXQUFXLEtBQUssQ0FBQztRQUNuQjtNQUNGO0lBQ0Y7RUFDRjtFQUNBLDJDQUEyQztFQUMzQyxDQUFDO0lBQ0MsTUFBTSxTQUFTLElBQUksUUFBUSxDQUFDLFNBQVM7SUFDckMsTUFBTSxZQUFxQyxFQUFFO0lBQzdDLElBQUk7TUFDRixXQUFXLE1BQU0sUUFBUSxNQUFPO1FBQzlCLE1BQU0sSUFBSSxRQUFRLE9BQU8sR0FBRyxJQUFJLENBQUMsSUFBTSxXQUFXO1FBQ2xELG9FQUFvRTtRQUNwRSxzRUFBc0U7UUFDdEUsa0VBQWtFO1FBQ2xFLHFFQUFxRTtRQUNyRSw0QkFBNEI7UUFDNUIsT0FBTyxLQUFLLENBQUM7UUFDYixNQUFNLElBQXNCLEVBQUUsSUFBSSxDQUFDLElBQ2pDLFVBQVUsTUFBTSxDQUFDLFVBQVUsT0FBTyxDQUFDLElBQUk7UUFFekMsVUFBVSxJQUFJLENBQUM7UUFDZixJQUFJLFVBQVUsTUFBTSxJQUFJLFdBQVc7VUFDakMsTUFBTSxRQUFRLElBQUksQ0FBQztRQUNyQjtNQUNGO01BQ0EsdUVBQXVFO01BQ3ZFLE1BQU0sUUFBUSxHQUFHLENBQUM7TUFDbEIsT0FBTyxLQUFLO0lBQ2QsRUFBRSxPQUFNO01BQ04sTUFBTSxTQUFTLEVBQUU7TUFDakIsS0FBSyxNQUFNLFVBQVUsQ0FBQSxNQUFNLFFBQVEsVUFBVSxDQUFDLFVBQVMsRUFBRztRQUN4RCxJQUFJLE9BQU8sTUFBTSxJQUFJLFlBQVk7VUFDL0IsT0FBTyxJQUFJLENBQUMsT0FBTyxNQUFNO1FBQzNCO01BQ0Y7TUFDQSxPQUFPLEtBQUssQ0FBQyxRQUFRLE1BQU0sQ0FDekIsSUFBSSxlQUFlLFFBQVEsK0JBQzFCLEtBQUssQ0FBQyxLQUFPO0lBQ2xCO0VBQ0YsQ0FBQztFQUNELE9BQU8sSUFBSSxRQUFRLENBQUMsT0FBTyxhQUFhLENBQUM7QUFDM0MifQ==
// denoCacheMetadata=15122990195925624882,15654601038525235848