// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
var _computedKey;
import { deferred } from "./deferred.ts";
_computedKey = Symbol.asyncIterator;
/**
 * The MuxAsyncIterator class multiplexes multiple async iterators into a single
 * stream. It currently makes an assumption that the final result (the value
 * returned and not yielded from the iterator) does not matter; if there is any
 * result, it is discarded.
 *
 * @example
 * ```typescript
 * import { MuxAsyncIterator } from "https://deno.land/std@$STD_VERSION/async/mod.ts";
 *
 * async function* gen123(): AsyncIterableIterator<number> {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 * }
 *
 * async function* gen456(): AsyncIterableIterator<number> {
 *   yield 4;
 *   yield 5;
 *   yield 6;
 * }
 *
 * const mux = new MuxAsyncIterator<number>();
 * mux.add(gen123());
 * mux.add(gen456());
 * for await (const value of mux) {
 *   // ...
 * }
 * // ..
 * ```
 */ export class MuxAsyncIterator {
  #iteratorCount = 0;
  #yields = [];
  // deno-lint-ignore no-explicit-any
  #throws = [];
  #signal = deferred();
  add(iterable) {
    ++this.#iteratorCount;
    this.#callIteratorNext(iterable[Symbol.asyncIterator]());
  }
  async #callIteratorNext(iterator) {
    try {
      const { value, done } = await iterator.next();
      if (done) {
        --this.#iteratorCount;
      } else {
        this.#yields.push({
          iterator,
          value
        });
      }
    } catch (e) {
      this.#throws.push(e);
    }
    this.#signal.resolve();
  }
  async *iterate() {
    while(this.#iteratorCount > 0){
      // Sleep until any of the wrapped iterators yields.
      await this.#signal;
      // Note that while we're looping over `yields`, new items may be added.
      for(let i = 0; i < this.#yields.length; i++){
        const { iterator, value } = this.#yields[i];
        yield value;
        this.#callIteratorNext(iterator);
      }
      if (this.#throws.length) {
        for (const e of this.#throws){
          throw e;
        }
        this.#throws.length = 0;
      }
      // Clear the `yields` list and reset the `signal` promise.
      this.#yields.length = 0;
      this.#signal = deferred();
    }
  }
  [_computedKey]() {
    return this.iterate();
  }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjE3Ny4wL2FzeW5jL211eF9hc3luY19pdGVyYXRvci50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIzIHRoZSBEZW5vIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuXG5pbXBvcnQgeyBEZWZlcnJlZCwgZGVmZXJyZWQgfSBmcm9tIFwiLi9kZWZlcnJlZC50c1wiO1xuXG5pbnRlcmZhY2UgVGFnZ2VkWWllbGRlZFZhbHVlPFQ+IHtcbiAgaXRlcmF0b3I6IEFzeW5jSXRlcmF0b3I8VD47XG4gIHZhbHVlOiBUO1xufVxuXG4vKipcbiAqIFRoZSBNdXhBc3luY0l0ZXJhdG9yIGNsYXNzIG11bHRpcGxleGVzIG11bHRpcGxlIGFzeW5jIGl0ZXJhdG9ycyBpbnRvIGEgc2luZ2xlXG4gKiBzdHJlYW0uIEl0IGN1cnJlbnRseSBtYWtlcyBhbiBhc3N1bXB0aW9uIHRoYXQgdGhlIGZpbmFsIHJlc3VsdCAodGhlIHZhbHVlXG4gKiByZXR1cm5lZCBhbmQgbm90IHlpZWxkZWQgZnJvbSB0aGUgaXRlcmF0b3IpIGRvZXMgbm90IG1hdHRlcjsgaWYgdGhlcmUgaXMgYW55XG4gKiByZXN1bHQsIGl0IGlzIGRpc2NhcmRlZC5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgTXV4QXN5bmNJdGVyYXRvciB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2FzeW5jL21vZC50c1wiO1xuICpcbiAqIGFzeW5jIGZ1bmN0aW9uKiBnZW4xMjMoKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPG51bWJlcj4ge1xuICogICB5aWVsZCAxO1xuICogICB5aWVsZCAyO1xuICogICB5aWVsZCAzO1xuICogfVxuICpcbiAqIGFzeW5jIGZ1bmN0aW9uKiBnZW40NTYoKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPG51bWJlcj4ge1xuICogICB5aWVsZCA0O1xuICogICB5aWVsZCA1O1xuICogICB5aWVsZCA2O1xuICogfVxuICpcbiAqIGNvbnN0IG11eCA9IG5ldyBNdXhBc3luY0l0ZXJhdG9yPG51bWJlcj4oKTtcbiAqIG11eC5hZGQoZ2VuMTIzKCkpO1xuICogbXV4LmFkZChnZW40NTYoKSk7XG4gKiBmb3IgYXdhaXQgKGNvbnN0IHZhbHVlIG9mIG11eCkge1xuICogICAvLyAuLi5cbiAqIH1cbiAqIC8vIC4uXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIE11eEFzeW5jSXRlcmF0b3I8VD4gaW1wbGVtZW50cyBBc3luY0l0ZXJhYmxlPFQ+IHtcbiAgI2l0ZXJhdG9yQ291bnQgPSAwO1xuICAjeWllbGRzOiBBcnJheTxUYWdnZWRZaWVsZGVkVmFsdWU8VD4+ID0gW107XG4gIC8vIGRlbm8tbGludC1pZ25vcmUgbm8tZXhwbGljaXQtYW55XG4gICN0aHJvd3M6IGFueVtdID0gW107XG4gICNzaWduYWw6IERlZmVycmVkPHZvaWQ+ID0gZGVmZXJyZWQoKTtcblxuICBhZGQoaXRlcmFibGU6IEFzeW5jSXRlcmFibGU8VD4pIHtcbiAgICArK3RoaXMuI2l0ZXJhdG9yQ291bnQ7XG4gICAgdGhpcy4jY2FsbEl0ZXJhdG9yTmV4dChpdGVyYWJsZVtTeW1ib2wuYXN5bmNJdGVyYXRvcl0oKSk7XG4gIH1cblxuICBhc3luYyAjY2FsbEl0ZXJhdG9yTmV4dChcbiAgICBpdGVyYXRvcjogQXN5bmNJdGVyYXRvcjxUPixcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgdmFsdWUsIGRvbmUgfSA9IGF3YWl0IGl0ZXJhdG9yLm5leHQoKTtcbiAgICAgIGlmIChkb25lKSB7XG4gICAgICAgIC0tdGhpcy4jaXRlcmF0b3JDb3VudDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuI3lpZWxkcy5wdXNoKHsgaXRlcmF0b3IsIHZhbHVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuI3Rocm93cy5wdXNoKGUpO1xuICAgIH1cbiAgICB0aGlzLiNzaWduYWwucmVzb2x2ZSgpO1xuICB9XG5cbiAgYXN5bmMgKml0ZXJhdGUoKTogQXN5bmNJdGVyYWJsZUl0ZXJhdG9yPFQ+IHtcbiAgICB3aGlsZSAodGhpcy4jaXRlcmF0b3JDb3VudCA+IDApIHtcbiAgICAgIC8vIFNsZWVwIHVudGlsIGFueSBvZiB0aGUgd3JhcHBlZCBpdGVyYXRvcnMgeWllbGRzLlxuICAgICAgYXdhaXQgdGhpcy4jc2lnbmFsO1xuXG4gICAgICAvLyBOb3RlIHRoYXQgd2hpbGUgd2UncmUgbG9vcGluZyBvdmVyIGB5aWVsZHNgLCBuZXcgaXRlbXMgbWF5IGJlIGFkZGVkLlxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLiN5aWVsZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgeyBpdGVyYXRvciwgdmFsdWUgfSA9IHRoaXMuI3lpZWxkc1tpXTtcbiAgICAgICAgeWllbGQgdmFsdWU7XG4gICAgICAgIHRoaXMuI2NhbGxJdGVyYXRvck5leHQoaXRlcmF0b3IpO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy4jdGhyb3dzLmxlbmd0aCkge1xuICAgICAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy4jdGhyb3dzKSB7XG4gICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLiN0aHJvd3MubGVuZ3RoID0gMDtcbiAgICAgIH1cbiAgICAgIC8vIENsZWFyIHRoZSBgeWllbGRzYCBsaXN0IGFuZCByZXNldCB0aGUgYHNpZ25hbGAgcHJvbWlzZS5cbiAgICAgIHRoaXMuI3lpZWxkcy5sZW5ndGggPSAwO1xuICAgICAgdGhpcy4jc2lnbmFsID0gZGVmZXJyZWQoKTtcbiAgICB9XG4gIH1cblxuICBbU3ltYm9sLmFzeW5jSXRlcmF0b3JdKCk6IEFzeW5jSXRlcmF0b3I8VD4ge1xuICAgIHJldHVybiB0aGlzLml0ZXJhdGUoKTtcbiAgfVxufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLDBFQUEwRTtBQUMxRSxxQ0FBcUM7O0FBRXJDLFNBQW1CLFFBQVEsUUFBUSxnQkFBZ0I7ZUEwRmhELE9BQU8sYUFBYTtBQW5GdkI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQThCQyxHQUNELE9BQU8sTUFBTTtFQUNYLENBQUEsYUFBYyxHQUFHLEVBQUU7RUFDbkIsQ0FBQSxNQUFPLEdBQWlDLEVBQUUsQ0FBQztFQUMzQyxtQ0FBbUM7RUFDbkMsQ0FBQSxNQUFPLEdBQVUsRUFBRSxDQUFDO0VBQ3BCLENBQUEsTUFBTyxHQUFtQixXQUFXO0VBRXJDLElBQUksUUFBMEIsRUFBRTtJQUM5QixFQUFFLElBQUksQ0FBQyxDQUFBLGFBQWM7SUFDckIsSUFBSSxDQUFDLENBQUEsZ0JBQWlCLENBQUMsUUFBUSxDQUFDLE9BQU8sYUFBYSxDQUFDO0VBQ3ZEO0VBRUEsTUFBTSxDQUFBLGdCQUFpQixDQUNyQixRQUEwQjtJQUUxQixJQUFJO01BQ0YsTUFBTSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsR0FBRyxNQUFNLFNBQVMsSUFBSTtNQUMzQyxJQUFJLE1BQU07UUFDUixFQUFFLElBQUksQ0FBQyxDQUFBLGFBQWM7TUFDdkIsT0FBTztRQUNMLElBQUksQ0FBQyxDQUFBLE1BQU8sQ0FBQyxJQUFJLENBQUM7VUFBRTtVQUFVO1FBQU07TUFDdEM7SUFDRixFQUFFLE9BQU8sR0FBRztNQUNWLElBQUksQ0FBQyxDQUFBLE1BQU8sQ0FBQyxJQUFJLENBQUM7SUFDcEI7SUFDQSxJQUFJLENBQUMsQ0FBQSxNQUFPLENBQUMsT0FBTztFQUN0QjtFQUVBLE9BQU8sVUFBb0M7SUFDekMsTUFBTyxJQUFJLENBQUMsQ0FBQSxhQUFjLEdBQUcsRUFBRztNQUM5QixtREFBbUQ7TUFDbkQsTUFBTSxJQUFJLENBQUMsQ0FBQSxNQUFPO01BRWxCLHVFQUF1RTtNQUN2RSxJQUFLLElBQUksSUFBSSxHQUFHLElBQUksSUFBSSxDQUFDLENBQUEsTUFBTyxDQUFDLE1BQU0sRUFBRSxJQUFLO1FBQzVDLE1BQU0sRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUEsTUFBTyxDQUFDLEVBQUU7UUFDM0MsTUFBTTtRQUNOLElBQUksQ0FBQyxDQUFBLGdCQUFpQixDQUFDO01BQ3pCO01BRUEsSUFBSSxJQUFJLENBQUMsQ0FBQSxNQUFPLENBQUMsTUFBTSxFQUFFO1FBQ3ZCLEtBQUssTUFBTSxLQUFLLElBQUksQ0FBQyxDQUFBLE1BQU8sQ0FBRTtVQUM1QixNQUFNO1FBQ1I7UUFDQSxJQUFJLENBQUMsQ0FBQSxNQUFPLENBQUMsTUFBTSxHQUFHO01BQ3hCO01BQ0EsMERBQTBEO01BQzFELElBQUksQ0FBQyxDQUFBLE1BQU8sQ0FBQyxNQUFNLEdBQUc7TUFDdEIsSUFBSSxDQUFDLENBQUEsTUFBTyxHQUFHO0lBQ2pCO0VBQ0Y7RUFFQSxpQkFBMkM7SUFDekMsT0FBTyxJQUFJLENBQUMsT0FBTztFQUNyQjtBQUNGIn0=
// denoCacheMetadata=9675671932571693888,7550922955709186335