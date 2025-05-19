// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
// Utility for representing n-tuple
class Queue {
  #source;
  #queue;
  head;
  done;
  constructor(iterable){
    this.#source = iterable[Symbol.asyncIterator]();
    this.#queue = {
      value: undefined,
      next: undefined
    };
    this.head = this.#queue;
    this.done = false;
  }
  async next() {
    const result = await this.#source.next();
    if (!result.done) {
      const nextNode = {
        value: result.value,
        next: undefined
      };
      this.#queue.next = nextNode;
      this.#queue = nextNode;
    } else {
      this.done = true;
    }
  }
}
/**
 * Branches the given async iterable into the n branches.
 *
 * @example
 * ```ts
 * import { tee } from "https://deno.land/std@$STD_VERSION/async/tee.ts";
 *
 * const gen = async function* gen() {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 * };
 *
 * const [branch1, branch2] = tee(gen());
 *
 * for await (const n of branch1) {
 *   console.log(n); // => 1, 2, 3
 * }
 *
 * for await (const n of branch2) {
 *   console.log(n); // => 1, 2, 3
 * }
 * ```
 */ export function tee(iterable, n = 2) {
  const queue = new Queue(iterable);
  async function* generator() {
    let buffer = queue.head;
    while(true){
      if (buffer.next) {
        buffer = buffer.next;
        yield buffer.value;
      } else if (queue.done) {
        return;
      } else {
        await queue.next();
      }
    }
  }
  const branches = Array.from({
    length: n
  }).map(()=>generator());
  return branches;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjE3Ny4wL2FzeW5jL3RlZS50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIzIHRoZSBEZW5vIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuXG4vLyBVdGlsaXR5IGZvciByZXByZXNlbnRpbmcgbi10dXBsZVxudHlwZSBUdXBsZTxULCBOIGV4dGVuZHMgbnVtYmVyPiA9IE4gZXh0ZW5kcyBOXG4gID8gbnVtYmVyIGV4dGVuZHMgTiA/IFRbXSA6IFR1cGxlT2Y8VCwgTiwgW10+XG4gIDogbmV2ZXI7XG50eXBlIFR1cGxlT2Y8VCwgTiBleHRlbmRzIG51bWJlciwgUiBleHRlbmRzIHVua25vd25bXT4gPSBSW1wibGVuZ3RoXCJdIGV4dGVuZHMgTlxuICA/IFJcbiAgOiBUdXBsZU9mPFQsIE4sIFtULCAuLi5SXT47XG5cbmludGVyZmFjZSBRdWV1ZU5vZGU8VD4ge1xuICB2YWx1ZTogVDtcbiAgbmV4dDogUXVldWVOb2RlPFQ+IHwgdW5kZWZpbmVkO1xufVxuXG5jbGFzcyBRdWV1ZTxUPiB7XG4gICNzb3VyY2U6IEFzeW5jSXRlcmF0b3I8VD47XG4gICNxdWV1ZTogUXVldWVOb2RlPFQ+O1xuICBoZWFkOiBRdWV1ZU5vZGU8VD47XG5cbiAgZG9uZTogYm9vbGVhbjtcblxuICBjb25zdHJ1Y3RvcihpdGVyYWJsZTogQXN5bmNJdGVyYWJsZTxUPikge1xuICAgIHRoaXMuI3NvdXJjZSA9IGl0ZXJhYmxlW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSgpO1xuICAgIHRoaXMuI3F1ZXVlID0ge1xuICAgICAgdmFsdWU6IHVuZGVmaW5lZCEsXG4gICAgICBuZXh0OiB1bmRlZmluZWQsXG4gICAgfTtcbiAgICB0aGlzLmhlYWQgPSB0aGlzLiNxdWV1ZTtcbiAgICB0aGlzLmRvbmUgPSBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIG5leHQoKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy4jc291cmNlLm5leHQoKTtcbiAgICBpZiAoIXJlc3VsdC5kb25lKSB7XG4gICAgICBjb25zdCBuZXh0Tm9kZTogUXVldWVOb2RlPFQ+ID0ge1xuICAgICAgICB2YWx1ZTogcmVzdWx0LnZhbHVlLFxuICAgICAgICBuZXh0OiB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgICAgdGhpcy4jcXVldWUubmV4dCA9IG5leHROb2RlO1xuICAgICAgdGhpcy4jcXVldWUgPSBuZXh0Tm9kZTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5kb25lID0gdHJ1ZTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBCcmFuY2hlcyB0aGUgZ2l2ZW4gYXN5bmMgaXRlcmFibGUgaW50byB0aGUgbiBicmFuY2hlcy5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGltcG9ydCB7IHRlZSB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2FzeW5jL3RlZS50c1wiO1xuICpcbiAqIGNvbnN0IGdlbiA9IGFzeW5jIGZ1bmN0aW9uKiBnZW4oKSB7XG4gKiAgIHlpZWxkIDE7XG4gKiAgIHlpZWxkIDI7XG4gKiAgIHlpZWxkIDM7XG4gKiB9O1xuICpcbiAqIGNvbnN0IFticmFuY2gxLCBicmFuY2gyXSA9IHRlZShnZW4oKSk7XG4gKlxuICogZm9yIGF3YWl0IChjb25zdCBuIG9mIGJyYW5jaDEpIHtcbiAqICAgY29uc29sZS5sb2cobik7IC8vID0+IDEsIDIsIDNcbiAqIH1cbiAqXG4gKiBmb3IgYXdhaXQgKGNvbnN0IG4gb2YgYnJhbmNoMikge1xuICogICBjb25zb2xlLmxvZyhuKTsgLy8gPT4gMSwgMiwgM1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0ZWU8VCwgTiBleHRlbmRzIG51bWJlciA9IDI+KFxuICBpdGVyYWJsZTogQXN5bmNJdGVyYWJsZTxUPixcbiAgbjogTiA9IDIgYXMgTixcbik6IFR1cGxlPEFzeW5jSXRlcmFibGU8VD4sIE4+IHtcbiAgY29uc3QgcXVldWUgPSBuZXcgUXVldWU8VD4oaXRlcmFibGUpO1xuXG4gIGFzeW5jIGZ1bmN0aW9uKiBnZW5lcmF0b3IoKTogQXN5bmNHZW5lcmF0b3I8VD4ge1xuICAgIGxldCBidWZmZXIgPSBxdWV1ZS5oZWFkO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAoYnVmZmVyLm5leHQpIHtcbiAgICAgICAgYnVmZmVyID0gYnVmZmVyLm5leHQ7XG4gICAgICAgIHlpZWxkIGJ1ZmZlci52YWx1ZTtcbiAgICAgIH0gZWxzZSBpZiAocXVldWUuZG9uZSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBxdWV1ZS5uZXh0KCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgY29uc3QgYnJhbmNoZXMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuIH0pLm1hcChcbiAgICAoKSA9PiBnZW5lcmF0b3IoKSxcbiAgKSBhcyBUdXBsZTxcbiAgICBBc3luY0l0ZXJhYmxlPFQ+LFxuICAgIE5cbiAgPjtcbiAgcmV0dXJuIGJyYW5jaGVzO1xufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLDBFQUEwRTtBQUMxRSxxQ0FBcUM7QUFFckMsbUNBQW1DO0FBYW5DLE1BQU07RUFDSixDQUFBLE1BQU8sQ0FBbUI7RUFDMUIsQ0FBQSxLQUFNLENBQWU7RUFDckIsS0FBbUI7RUFFbkIsS0FBYztFQUVkLFlBQVksUUFBMEIsQ0FBRTtJQUN0QyxJQUFJLENBQUMsQ0FBQSxNQUFPLEdBQUcsUUFBUSxDQUFDLE9BQU8sYUFBYSxDQUFDO0lBQzdDLElBQUksQ0FBQyxDQUFBLEtBQU0sR0FBRztNQUNaLE9BQU87TUFDUCxNQUFNO0lBQ1I7SUFDQSxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxDQUFBLEtBQU07SUFDdkIsSUFBSSxDQUFDLElBQUksR0FBRztFQUNkO0VBRUEsTUFBTSxPQUFPO0lBQ1gsTUFBTSxTQUFTLE1BQU0sSUFBSSxDQUFDLENBQUEsTUFBTyxDQUFDLElBQUk7SUFDdEMsSUFBSSxDQUFDLE9BQU8sSUFBSSxFQUFFO01BQ2hCLE1BQU0sV0FBeUI7UUFDN0IsT0FBTyxPQUFPLEtBQUs7UUFDbkIsTUFBTTtNQUNSO01BQ0EsSUFBSSxDQUFDLENBQUEsS0FBTSxDQUFDLElBQUksR0FBRztNQUNuQixJQUFJLENBQUMsQ0FBQSxLQUFNLEdBQUc7SUFDaEIsT0FBTztNQUNMLElBQUksQ0FBQyxJQUFJLEdBQUc7SUFDZDtFQUNGO0FBQ0Y7QUFFQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Q0F1QkMsR0FDRCxPQUFPLFNBQVMsSUFDZCxRQUEwQixFQUMxQixJQUFPLENBQU07RUFFYixNQUFNLFFBQVEsSUFBSSxNQUFTO0VBRTNCLGdCQUFnQjtJQUNkLElBQUksU0FBUyxNQUFNLElBQUk7SUFDdkIsTUFBTyxLQUFNO01BQ1gsSUFBSSxPQUFPLElBQUksRUFBRTtRQUNmLFNBQVMsT0FBTyxJQUFJO1FBQ3BCLE1BQU0sT0FBTyxLQUFLO01BQ3BCLE9BQU8sSUFBSSxNQUFNLElBQUksRUFBRTtRQUNyQjtNQUNGLE9BQU87UUFDTCxNQUFNLE1BQU0sSUFBSTtNQUNsQjtJQUNGO0VBQ0Y7RUFFQSxNQUFNLFdBQVcsTUFBTSxJQUFJLENBQUM7SUFBRSxRQUFRO0VBQUUsR0FBRyxHQUFHLENBQzVDLElBQU07RUFLUixPQUFPO0FBQ1QifQ==
// denoCacheMetadata=17943809697351208150,13616398800922954835