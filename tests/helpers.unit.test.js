// @ts-check
/**
 * Unit tests for helpers.js
 * Tests pure helper functions from the helpers.js module
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import {
  getHeader,
  getAllHeaders,
  getCacheTimestamp,
  isFresh,
  isStale,
  addTimestamp,
  getInferredInvalidationPaths,
  getStrategy,
  getTTL,
  getStaleTTL,
  matchesScope,
  validateConfig,
  isOlderThanMaxAge,
  cleanupOldCacheEntries
} from "../src/helpers.js";
import { MockCacheStorage } from "./MockCache.js";

// Mock Cache API for Node.js environment
// @ts-ignore - Mocking browser API for Node.js tests
globalThis.caches = globalThis.caches || new MockCacheStorage();

describe("getHeader", () => {
  test("returns header value when present", () => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    const result = getHeader(headers, "Content-Type");
    assert.strictEqual(result, "application/json");
  });

  test("returns null when header is not present", () => {
    const headers = new Headers();
    const result = getHeader(headers, "X-Missing-Header");
    assert.strictEqual(result, null);
  });

  test("is case-insensitive", () => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    assert.strictEqual(getHeader(headers, "content-type"), "application/json");
    assert.strictEqual(getHeader(headers, "CONTENT-TYPE"), "application/json");
    assert.strictEqual(getHeader(headers, "Content-Type"), "application/json");
  });
});

describe("getAllHeaders", () => {
  test("returns array with single value when header is set once", () => {
    const headers = new Headers();
    headers.set("X-Test", "value1");
    const result = getAllHeaders(headers, "X-Test");
    assert.deepStrictEqual(result, ["value1"]);
  });

  test("returns array with multiple values when header is set multiple times", () => {
    // Headers.append() concatenates values with ", " (comma+space) per HTTP spec
    // getAllHeaders splits them back into individual values
    const headers = new Headers();
    headers.append("X-Test", "value1");
    headers.append("X-Test", "value2");
    headers.append("X-Test", "value3");
    const result = getAllHeaders(headers, "X-Test");
    // Should be split into separate values
    assert.deepStrictEqual(result, ["value1", "value2", "value3"]);
  });

  test("handles single value with comma+space correctly", () => {
    // Edge case: if a value legitimately contains ", " it will be split
    // This is acceptable for URL paths (commas in URLs are percent-encoded)
    const headers = new Headers();
    headers.set("X-Test", "value1, value2");
    const result = getAllHeaders(headers, "X-Test");
    assert.deepStrictEqual(result, ["value1", "value2"]);
  });

  test("handles empty values after splitting", () => {
    const headers = new Headers();
    headers.set("X-Test", "value1, , value3");
    const result = getAllHeaders(headers, "X-Test");
    assert.deepStrictEqual(result, ["value1", "", "value3"]);
  });

  test("returns empty array when header is not present", () => {
    const headers = new Headers();
    const result = getAllHeaders(headers, "X-Missing-Header");
    assert.deepStrictEqual(result, []);
  });

  test("is case-insensitive", () => {
    const headers = new Headers();
    headers.set("X-Test", "value1");
    assert.deepStrictEqual(getAllHeaders(headers, "x-test"), ["value1"]);
    assert.deepStrictEqual(getAllHeaders(headers, "X-TEST"), ["value1"]);
  });
});

describe("getCacheTimestamp", () => {
  test("returns timestamp when header is present", () => {
    const timestamp = Date.now();
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = getCacheTimestamp(response);
    assert.strictEqual(result, timestamp);
  });

  test("returns null when header is not present", () => {
    const response = new Response();
    const result = getCacheTimestamp(response);
    assert.strictEqual(result, null);
  });

  test("returns null when header value is not a number", () => {
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", "not-a-number");
    const response = new Response(null, { headers });
    const result = getCacheTimestamp(response);
    assert.strictEqual(result, null);
  });

  test("parses timestamp correctly", () => {
    const timestamp = 1234567890;
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = getCacheTimestamp(response);
    assert.strictEqual(result, timestamp);
  });
});

describe("isFresh", () => {
  test("returns true when response is fresh", () => {
    const timestamp = Date.now() - 1000; // 1 second ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isFresh(response, 5); // 5 second TTL
    assert.strictEqual(result, true);
  });

  test("returns false when response is stale", () => {
    const timestamp = Date.now() - 10000; // 10 seconds ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isFresh(response, 5); // 5 second TTL
    assert.strictEqual(result, false);
  });

  test("returns false when timestamp header is missing", () => {
    const response = new Response();
    const result = isFresh(response, 5);
    assert.strictEqual(result, false);
  });

  test("returns false when response is exactly at TTL boundary", () => {
    const timestamp = Date.now() - 5000; // exactly 5 seconds ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isFresh(response, 5); // 5 second TTL
    assert.strictEqual(result, false); // age >= ttl, so not fresh
  });
});

describe("isStale", () => {
  test("returns true when response is stale but within stale TTL", () => {
    const timestamp = Date.now() - 10000; // 10 seconds ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isStale(response, 5, 20); // 5s TTL, 20s stale TTL
    assert.strictEqual(result, true);
  });

  test("returns false when response is fresh", () => {
    const timestamp = Date.now() - 1000; // 1 second ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isStale(response, 5, 20); // 5s TTL, 20s stale TTL
    assert.strictEqual(result, false);
  });

  test("returns false when response exceeds stale TTL", () => {
    const timestamp = Date.now() - 30000; // 30 seconds ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isStale(response, 5, 20); // 5s TTL, 20s stale TTL
    assert.strictEqual(result, false);
  });

  test("returns false when staleTTL is null", () => {
    const timestamp = Date.now() - 10000; // 10 seconds ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isStale(response, 5, null);
    assert.strictEqual(result, false);
  });

  test("returns false when timestamp header is missing", () => {
    const response = new Response();
    const result = isStale(response, 5, 20);
    assert.strictEqual(result, false);
  });
});

describe("addTimestamp", () => {
  test("adds timestamp header to response", () => {
    const originalResponse = new Response("test body", {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "text/plain" }
    });
    const result = addTimestamp(originalResponse);
    const timestamp = getCacheTimestamp(result);
    assert.notStrictEqual(timestamp, null);
    assert.ok(typeof timestamp === "number");
    assert.ok(timestamp > 0);
  });

  test("preserves response body", async () => {
    const originalResponse = new Response("test body");
    const result = addTimestamp(originalResponse);
    const body = await result.text();
    assert.strictEqual(body, "test body");
  });

  test("preserves response status and statusText", () => {
    const originalResponse = new Response(null, {
      status: 404,
      statusText: "Not Found"
    });
    const result = addTimestamp(originalResponse);
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.statusText, "Not Found");
  });

  test("preserves existing headers", () => {
    const originalResponse = new Response(null, {
      headers: { "Content-Type": "application/json", "X-Custom": "value" }
    });
    const result = addTimestamp(originalResponse);
    assert.strictEqual(result.headers.get("Content-Type"), "application/json");
    assert.strictEqual(result.headers.get("X-Custom"), "value");
  });
});

describe("getInferredInvalidationPaths", () => {
  test("returns exact URL and parent collection path", () => {
    const url = "https://example.com/api/users/123";
    const result = getInferredInvalidationPaths(url);
    assert.deepStrictEqual(result, [
      "https://example.com/api/users/123",
      "https://example.com/api/users"
    ]);
  });

  test("handles root path", () => {
    const url = "https://example.com/";
    const result = getInferredInvalidationPaths(url);
    assert.deepStrictEqual(result, ["https://example.com/"]);
  });

  test("handles single segment path", () => {
    const url = "https://example.com/api";
    const result = getInferredInvalidationPaths(url);
    assert.deepStrictEqual(result, ["https://example.com/api"]);
  });

  test("handles nested paths", () => {
    const url = "https://example.com/api/users/123/posts/456";
    const result = getInferredInvalidationPaths(url);
    assert.deepStrictEqual(result, [
      "https://example.com/api/users/123/posts/456",
      "https://example.com/api/users/123/posts"
    ]);
  });

  test("preserves query strings in exact URL", () => {
    const url = "https://example.com/api/users/123?foo=bar";
    const result = getInferredInvalidationPaths(url);
    assert.deepStrictEqual(result, [
      "https://example.com/api/users/123?foo=bar",
      "https://example.com/api/users"
    ]);
  });
});

describe("getStrategy", () => {
  test("returns header value when valid strategy is provided", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-Strategy", "network-first");
    const result = getStrategy(headers, "cache-first");
    assert.strictEqual(result, "network-first");
  });

  test("returns default when header is not present", () => {
    const headers = new Headers();
    const result = getStrategy(headers, "cache-first");
    assert.strictEqual(result, "cache-first");
  });

  test("returns default when header value is invalid", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-Strategy", "invalid-strategy");
    const result = getStrategy(headers, "cache-first");
    assert.strictEqual(result, "cache-first");
  });

  test("is case-sensitive for strategy values", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-Strategy", "CACHE-FIRST");
    const result = getStrategy(headers, "network-first");
    assert.strictEqual(result, "network-first"); // Should use default
  });

  test("supports all valid strategies", () => {
    const headers = new Headers();
    const strategies = [
      "cache-first",
      "network-first",
      "stale-while-revalidate"
    ];
    for (const strategy of strategies) {
      headers.set("X-SW-Cache-Strategy", strategy);
      const result = getStrategy(headers, "network-first");
      assert.strictEqual(result, strategy);
    }
  });
});

describe("getTTL", () => {
  test("returns header value when valid TTL is provided", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-TTL-Seconds", "60");
    const result = getTTL(headers, 300);
    assert.strictEqual(result, 60);
  });

  test("returns default when header is not present and default > 0", () => {
    const headers = new Headers();
    const result = getTTL(headers, 300);
    assert.strictEqual(result, 300);
  });

  test("returns null when header is not present and default is 0", () => {
    const headers = new Headers();
    const result = getTTL(headers, 0);
    assert.strictEqual(result, null);
  });

  test("returns null when header value is 0", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-TTL-Seconds", "0");
    const result = getTTL(headers, 300);
    assert.strictEqual(result, null);
  });

  test("returns null when header value is negative", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-TTL-Seconds", "-10");
    const result = getTTL(headers, 300);
    assert.strictEqual(result, null);
  });

  test("returns null when header value is not a number", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-TTL-Seconds", "not-a-number");
    const result = getTTL(headers, 300);
    assert.strictEqual(result, null);
  });

  test("parses valid TTL correctly", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-TTL-Seconds", "123");
    const result = getTTL(headers, 300);
    assert.strictEqual(result, 123);
  });
});

describe("getStaleTTL", () => {
  test("returns header value when valid stale TTL is provided", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-Stale-TTL-Seconds", "1200");
    const result = getStaleTTL(headers, 3600);
    assert.strictEqual(result, 1200);
  });

  test("returns default when header is not present and default > 0", () => {
    const headers = new Headers();
    const result = getStaleTTL(headers, 3600);
    assert.strictEqual(result, 3600);
  });

  test("returns null when header is not present and default is 0", () => {
    const headers = new Headers();
    const result = getStaleTTL(headers, 0);
    assert.strictEqual(result, null);
  });

  test("returns null when header value is 0", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-Stale-TTL-Seconds", "0");
    const result = getStaleTTL(headers, 3600);
    assert.strictEqual(result, null);
  });

  test("returns null when header value is negative", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-Stale-TTL-Seconds", "-10");
    const result = getStaleTTL(headers, 3600);
    assert.strictEqual(result, null);
  });

  test("returns null when header value is not a number", () => {
    const headers = new Headers();
    headers.set("X-SW-Cache-Stale-TTL-Seconds", "not-a-number");
    const result = getStaleTTL(headers, 3600);
    assert.strictEqual(result, null);
  });
});

describe("matchesScope", () => {
  test("returns true when scope is empty and defaultTTLSeconds > 0", () => {
    const result = matchesScope("https://example.com/api/users", [], 300);
    assert.strictEqual(result, true);
  });

  test("returns false when scope is empty and defaultTTLSeconds is 0", () => {
    const result = matchesScope("https://example.com/api/users", [], 0);
    assert.strictEqual(result, false);
  });

  test("returns true when URL matches scope prefix", () => {
    const result = matchesScope(
      "https://example.com/api/users",
      ["/api/"],
      300
    );
    assert.strictEqual(result, true);
  });

  test("returns false when URL does not match scope prefix", () => {
    const result = matchesScope(
      "https://example.com/other/path",
      ["/api/"],
      300
    );
    assert.strictEqual(result, false);
  });

  test("returns true when URL matches any scope prefix", () => {
    const result = matchesScope(
      "https://example.com/graphql/query",
      ["/api/", "/graphql/"],
      300
    );
    assert.strictEqual(result, true);
  });
});

describe("validateConfig", () => {
  test("throws error when config is not an object", () => {
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig(null),
      /config is required and must be an object/
    );
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig(undefined),
      /config is required and must be an object/
    );
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig("string"),
      /config is required and must be an object/
    );
  });

  test("throws error when cacheName is missing", () => {
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig({}),
      /config.cacheName is required and must be a string/
    );
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig({ cacheName: null }),
      /config.cacheName is required and must be a string/
    );
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig({ cacheName: 123 }),
      /config.cacheName is required and must be a string/
    );
  });

  test("throws error when defaultStrategy is invalid", () => {
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig({ cacheName: "test", defaultStrategy: "invalid" }),
      /config.defaultStrategy must be one of/
    );
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig({ cacheName: "test", defaultStrategy: "cache" }),
      /config.defaultStrategy must be one of/
    );
  });

  test("does not throw when config is valid", () => {
    assert.doesNotThrow(() => validateConfig({ cacheName: "test-cache" }));
    assert.doesNotThrow(() =>
      validateConfig({
        cacheName: "test-cache",
        defaultStrategy: "cache-first"
      })
    );
    assert.doesNotThrow(() =>
      validateConfig({
        cacheName: "test-cache",
        defaultStrategy: "network-first"
      })
    );
    assert.doesNotThrow(() =>
      validateConfig({
        cacheName: "test-cache",
        defaultStrategy: "stale-while-revalidate"
      })
    );
  });

  test("throws error when maxCacheAgeSeconds is not a number", () => {
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig({ cacheName: "test", maxCacheAgeSeconds: "7200" }),
      /config.maxCacheAgeSeconds must be a positive number if provided/
    );
    assert.throws(
      // @ts-expect-error - intentionally testing invalid input
      () => validateConfig({ cacheName: "test", maxCacheAgeSeconds: null }),
      /config.maxCacheAgeSeconds must be a positive number if provided/
    );
  });

  test("throws error when maxCacheAgeSeconds is zero or negative", () => {
    assert.throws(
      () => validateConfig({ cacheName: "test", maxCacheAgeSeconds: 0 }),
      /config.maxCacheAgeSeconds must be a positive number if provided/
    );
    assert.throws(
      () => validateConfig({ cacheName: "test", maxCacheAgeSeconds: -100 }),
      /config.maxCacheAgeSeconds must be a positive number if provided/
    );
  });

  test("does not throw when maxCacheAgeSeconds is valid", () => {
    assert.doesNotThrow(() =>
      validateConfig({ cacheName: "test", maxCacheAgeSeconds: 7200 })
    );
    assert.doesNotThrow(() =>
      validateConfig({ cacheName: "test", maxCacheAgeSeconds: 1 })
    );
  });
});

describe("isOlderThanMaxAge", () => {
  test("returns true when response is older than max age", () => {
    const timestamp = Date.now() - 10000; // 10 seconds ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isOlderThanMaxAge(response, 5); // 5 second max age
    assert.strictEqual(result, true);
  });

  test("returns false when response is newer than max age", () => {
    const timestamp = Date.now() - 1000; // 1 second ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isOlderThanMaxAge(response, 5); // 5 second max age
    assert.strictEqual(result, false);
  });

  test("returns false when timestamp header is missing", () => {
    const response = new Response();
    const result = isOlderThanMaxAge(response, 5);
    assert.strictEqual(result, false);
  });

  test("returns true when response is exactly at max age boundary", () => {
    const timestamp = Date.now() - 5000; // exactly 5 seconds ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isOlderThanMaxAge(response, 5); // 5 second max age
    assert.strictEqual(result, true); // age >= maxAge, so older
  });

  test("handles large max age values", () => {
    const timestamp = Date.now() - 7200000; // 2 hours ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response(null, { headers });
    const result = isOlderThanMaxAge(response, 7200); // 2 hour max age
    assert.strictEqual(result, true);
  });
});

describe("cleanupOldCacheEntries", () => {
  test("deletes entries older than max age", async () => {
    const cacheName = `test-cache-${Date.now()}`;
    const cache = await caches.open(cacheName);

    // Create requests
    const request1 = new Request("https://example.com/api/users");
    const request2 = new Request("https://example.com/api/posts");

    // Create responses with different timestamps
    const oldTimestamp = Date.now() - 10000; // 10 seconds ago
    const newTimestamp = Date.now() - 1000; // 1 second ago

    const oldHeaders = new Headers();
    oldHeaders.set("x-sw-cache-timestamp", oldTimestamp.toString());
    const oldResponse = new Response("old data", { headers: oldHeaders });

    const newHeaders = new Headers();
    newHeaders.set("x-sw-cache-timestamp", newTimestamp.toString());
    const newResponse = new Response("new data", { headers: newHeaders });

    // Add both to cache
    await cache.put(request1, oldResponse);
    await cache.put(request2, newResponse);

    // Cleanup entries older than 5 seconds
    await cleanupOldCacheEntries(cacheName, 5);

    // Old entry should be deleted
    const oldCached = await cache.match(request1);
    assert.strictEqual(oldCached, undefined);

    // New entry should still exist
    const newCached = await cache.match(request2);
    assert.notStrictEqual(newCached, null);
    assert.notStrictEqual(newCached, undefined);
    if (newCached) {
      const newCachedText = await newCached.text();
      assert.strictEqual(newCachedText, "new data");
    }

    // Cleanup
    await caches.delete(cacheName);
  });

  test("does not delete entries newer than max age", async () => {
    const cacheName = `test-cache-${Date.now()}`;
    const cache = await caches.open(cacheName);

    const request = new Request("https://example.com/api/users");
    const timestamp = Date.now() - 1000; // 1 second ago
    const headers = new Headers();
    headers.set("x-sw-cache-timestamp", timestamp.toString());
    const response = new Response("data", { headers });

    await cache.put(request, response);

    // Cleanup entries older than 5 seconds (should not delete this one)
    await cleanupOldCacheEntries(cacheName, 5);

    const cached = await cache.match(request);
    assert.notStrictEqual(cached, null);
    assert.notStrictEqual(cached, undefined);
    if (cached) {
      const cachedText = await cached.text();
      assert.strictEqual(cachedText, "data");
    }

    // Cleanup
    await caches.delete(cacheName);
  });

  test("handles empty cache", async () => {
    const cacheName = `test-cache-${Date.now()}`;
    await caches.open(cacheName);

    // Should not throw
    await cleanupOldCacheEntries(cacheName, 5);

    // Cleanup
    await caches.delete(cacheName);
  });

  test("handles entries without timestamp header", async () => {
    const cacheName = `test-cache-${Date.now()}`;
    const cache = await caches.open(cacheName);

    const request = new Request("https://example.com/api/users");
    const response = new Response("data"); // No timestamp header

    await cache.put(request, response);

    // Should not delete entries without timestamp
    await cleanupOldCacheEntries(cacheName, 5);

    const cached = await cache.match(request);
    assert.notStrictEqual(cached, null);

    // Cleanup
    await caches.delete(cacheName);
  });

  test("deletes multiple old entries", async () => {
    const cacheName = `test-cache-${Date.now()}`;
    const cache = await caches.open(cacheName);

    const oldTimestamp = Date.now() - 10000; // 10 seconds ago
    const oldHeaders = new Headers();
    oldHeaders.set("x-sw-cache-timestamp", oldTimestamp.toString());

    // Create multiple old entries
    const requests = [
      new Request("https://example.com/api/users"),
      new Request("https://example.com/api/posts"),
      new Request("https://example.com/api/comments")
    ];

    for (const req of requests) {
      await cache.put(req, new Response("old data", { headers: oldHeaders }));
    }

    // Add one new entry
    const newTimestamp = Date.now() - 1000; // 1 second ago
    const newHeaders = new Headers();
    newHeaders.set("x-sw-cache-timestamp", newTimestamp.toString());
    await cache.put(
      new Request("https://example.com/api/new"),
      new Response("new data", { headers: newHeaders })
    );

    // Cleanup entries older than 5 seconds
    await cleanupOldCacheEntries(cacheName, 5);

    // All old entries should be deleted
    for (const req of requests) {
      const cached = await cache.match(req);
      assert.strictEqual(cached, undefined);
    }

    // New entry should still exist
    const newCached = await cache.match(
      new Request("https://example.com/api/new")
    );
    assert.notStrictEqual(newCached, null);

    // Cleanup
    await caches.delete(cacheName);
  });
});
