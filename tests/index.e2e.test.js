// @ts-check
/**
 * E2E tests for index.js - createHandleRequest
 * Tests the full request handler with all caching strategies and headers
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { createHandleRequest } from "../src/index.js";
import { MockCacheStorage } from "./MockCache.js";

// Mock Cache API for Node.js environment
// @ts-ignore - Mocking browser API for Node.js tests
globalThis.caches = globalThis.caches || new MockCacheStorage();

// Helper to create a FetchEvent-like object
/**
 * @param {Request} request
 * @returns {FetchEvent}
 */
function createFetchEvent(request) {
  return /** @type {FetchEvent} */ ({ request });
}

// Helper to create a mock fetch function
/**
 * @param {Map<string, Response>} responses - Map of URL to Response
 * @param {Map<string, Error>} errors - Map of URL to Error to throw
 * @returns {{ fetch: typeof globalThis.fetch, getCallCount: () => number, reset: (newResponses?: Map<string, Response>, newErrors?: Map<string, Error>) => void }}
 */
function createMockFetch(responses = new Map(), errors = new Map()) {
  let callCount = 0;
  let currentResponses = responses;
  let currentErrors = errors;
  const fetch = async (request) => {
    callCount++;
    const url = request.url;
    if (currentErrors.has(url)) {
      throw currentErrors.get(url);
    }
    const response =
      currentResponses.get(url) ?? new Response("Not found", { status: 404 });

    // Ensure response has URL property set (Response.url is read-only)
    // If it doesn't have one, clone it and attach the URL
    if (!response.url) {
      const clonedResponse = response.clone();
      Object.defineProperty(clonedResponse, "url", {
        value: url,
        writable: false,
        enumerable: true,
        configurable: true
      });
      return clonedResponse;
    }
    return response;
  };
  const reset = (newResponses, newErrors) => {
    callCount = 0;
    if (newResponses !== undefined) {
      currentResponses = newResponses;
    }
    if (newErrors !== undefined) {
      currentErrors = newErrors;
    }
  };
  return { fetch, getCallCount: () => callCount, reset };
}

// Note: Use context.mock.timers in tests to advance time instead of waiting

describe("createHandleRequest", () => {
  describe("cache-first strategy", () => {
    test("returns fresh cached response without network request", async () => {
      const cacheName = "test-cache-first-fresh";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create custom fetch to track calls
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([[url, new Response("Network data", { status: 200 })]])
      );

      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      // First request - should fetch from network and cache the response
      const firstEvent = createFetchEvent(request);
      const firstResult = await handleRequest(firstEvent);
      assert(firstResult, "First request should return a response");
      const firstText = await firstResult.text();

      assert.strictEqual(firstText, "Network data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Verify network response does NOT have x-sw-cache-timestamp header
      // (header is only added when caching, not on network responses)
      assert.strictEqual(
        firstResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Network response should not have x-sw-cache-timestamp header"
      );

      // Second request - should return from cache without network call
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      assert(secondResult, "Second request should return a response");
      const secondText = await secondResult.text();

      assert.strictEqual(secondText, "Network data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should not be called on second request"
      );

      // Verify cached response has x-sw-cache-timestamp header
      assert.notStrictEqual(
        secondResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Cached response should have x-sw-cache-timestamp header"
      );
    });

    test("caches different URLs independently", async () => {
      const cacheName = "test-cache-first-independent";
      const url1 = "https://example.com/api/users";
      const url2 = "https://example.com/api/posts";
      const request1 = new Request(url1);
      const request2 = new Request(url2);

      // Create custom fetch with responses for both URLs
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([
          [url1, new Response("Users data", { status: 200 })],
          [url2, new Response("Posts data", { status: 200 })]
        ])
      );

      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      // First request for url1 - should fetch from network
      const firstEvent1 = createFetchEvent(request1);
      const firstResult1 = await handleRequest(firstEvent1);
      const firstText1 = await firstResult1?.text();

      assert.strictEqual(firstText1, "Users data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called for first URL"
      );

      // Second request for url1 - should return from cache
      const secondEvent1 = createFetchEvent(request1);
      const secondResult1 = await handleRequest(secondEvent1);
      const secondText1 = await secondResult1?.text();

      assert.strictEqual(secondText1, "Users data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should not be called again for cached URL1"
      );

      // First request for url2 - should fetch from network (not cached)
      const firstEvent2 = createFetchEvent(request2);
      const firstResult2 = await handleRequest(firstEvent2);
      const firstText2 = await firstResult2?.text();

      assert.strictEqual(firstText2, "Posts data");
      assert.strictEqual(
        getCallCount(),
        2,
        "Fetch should be called for url2 even though url1 is cached"
      );

      // Verify both URLs are cached independently
      const cache = await caches.open(cacheName);
      const cached1 = await cache.match(request1);
      const cached2 = await cache.match(request2);

      assert(cached1, "url1 should be cached");
      assert(cached2, "url2 should be cached");

      const cachedText1 = await cached1.text();
      const cachedText2 = await cached2.text();

      assert.strictEqual(cachedText1, "Users data");
      assert.strictEqual(cachedText2, "Posts data");
    });

    test("fetches from network when cache is stale and updates cache", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-cache-first-stale";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that returns old data initially
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Old network data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 1, // 1 second TTL
        customFetch
      });

      // First request - populate cache with old data
      const firstEvent = createFetchEvent(request);
      const firstResult = await handleRequest(firstEvent);
      const firstText = await firstResult?.text();
      assert.strictEqual(firstText, "Old network data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Advance time to make cache stale
      testContext.mock.timers.tick(1100);

      // Reset mock fetch to return new data and reset call count
      reset(
        new Map([[url, new Response("New network data", { status: 200 })]])
      );

      // Second request - should fetch new data since cache is stale
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      const secondText = await secondResult?.text();

      assert.strictEqual(secondText, "New network data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called when cache is stale"
      );

      // Verify cache was updated
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(request);
      assert(cachedResponse, "Cache should be updated");
      const cachedText = await cachedResponse.text();
      assert.strictEqual(cachedText, "New network data");

      // Reset timers
      testContext.mock.timers.reset();
    });

    test("returns stale cache when network fails (offline fallback)", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-cache-first-offline";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that succeeds initially
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 1,
        defaultStaleTTLSeconds: 10,
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      const firstResult = await handleRequest(firstEvent);
      const firstText = await firstResult?.text();
      assert.strictEqual(firstText, "Cached data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Advance time to make cache stale but not too stale
      testContext.mock.timers.tick(1100);

      // Reset mock fetch to fail (simulate offline)
      reset(new Map(), new Map([[url, new Error("Network error")]]));

      // Second request - should return stale cache when network fails
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      assert(secondResult, "Should return cached response");
      const secondText = await secondResult.text();

      assert.strictEqual(secondText, "Cached data");

      // Verify cached response has x-sw-cache-timestamp header
      assert.notStrictEqual(
        secondResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Cached response should have x-sw-cache-timestamp header"
      );
    });

    test("throws error when network fails and cache is too stale", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-cache-first-too-stale";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that succeeds initially
      const { fetch: customFetch, reset } = createMockFetch(
        new Map([[url, new Response("Old cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 1,
        defaultStaleTTLSeconds: 2,
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      await handleRequest(firstEvent);

      // Advance time to make cache too stale
      testContext.mock.timers.tick(2100);

      // Reset mock fetch to fail
      reset(new Map(), new Map([[url, new Error("Network error")]]));

      // Second request - should throw error when cache is too stale and network fails
      const secondEvent = createFetchEvent(request);
      await assert.rejects(
        async () => {
          await handleRequest(secondEvent);
        },
        { message: "Network error" }
      );
    });

    test("does not cache non-2xx responses", async () => {
      const cacheName = "test-cache-first-non-ok";
      const url = "https://example.com/api/users";
      const request = new Request(url);
      const event = createFetchEvent(request);

      // Create handler with custom fetch that returns 404
      const { fetch: customFetch } = createMockFetch(
        new Map([[url, new Response("Not found", { status: 404 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      const result = await handleRequest(event);
      assert(result, "Should return a response");
      assert.strictEqual(result.status, 404);

      // Verify cache was not updated (non-2xx responses are not cached)
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(request);
      assert.strictEqual(cachedResponse, undefined);
    });
  });

  describe("network-first strategy", () => {
    test("returns network response when available and caches it", async () => {
      const cacheName = "test-network-first-success";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Network data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "network-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      // First request - should fetch from network
      const firstEvent = createFetchEvent(request);
      const firstResult = await handleRequest(firstEvent);
      assert(firstResult, "Should return a response");
      const firstText = await firstResult.text();

      assert.strictEqual(firstText, "Network data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Verify cache was updated
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(request);
      assert(cachedResponse, "Cache should be updated");
      const cachedText = await cachedResponse.text();
      assert.strictEqual(cachedText, "Network data");

      // Reset mock fetch to return different data
      reset(
        new Map([[url, new Response("Updated network data", { status: 200 })]])
      );

      // Second request - should still fetch from network (network-first strategy)
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      assert(secondResult, "Should return a response");
      const secondText = await secondResult.text();

      assert.strictEqual(secondText, "Updated network data");
      assert.strictEqual(
        getCallCount(),
        1, // count will be 1 because we reset the mock fetch to return different data
        "Fetch should be called again on second request (network-first)"
      );

      // Verify cache was updated again after second request with new data
      const updatedCachedResponse = await cache.match(request);
      assert(
        updatedCachedResponse,
        "Cache should be updated after second request"
      );
      const updatedCachedText = await updatedCachedResponse.text();
      assert.strictEqual(
        updatedCachedText,
        "Updated network data",
        "Cache should contain the new data from second request"
      );
    });

    test("falls back to fresh cache when network fails", async () => {
      const cacheName = "test-network-first-fallback-fresh";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that succeeds initially
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "network-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      const firstResult = await handleRequest(firstEvent);
      assert(firstResult, "Should return a response");
      const firstText = await firstResult.text();
      assert.strictEqual(firstText, "Cached data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Verify network response does NOT have x-sw-cache-timestamp header
      assert.strictEqual(
        firstResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Network response should not have x-sw-cache-timestamp header"
      );

      // Reset mock fetch to fail
      reset(new Map(), new Map([[url, new Error("Network error")]]));

      // Second request - should return cached response when network fails
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      assert(secondResult, "Should return cached response");
      const secondText = await secondResult.text();

      assert.strictEqual(secondText, "Cached data");

      // Verify cached response has x-sw-cache-timestamp header
      assert.notStrictEqual(
        secondResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Cached response should have x-sw-cache-timestamp header"
      );
    });

    test("falls back to stale cache when network fails", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-network-first-fallback-stale";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that succeeds initially
      const { fetch: customFetch, reset } = createMockFetch(
        new Map([[url, new Response("Stale cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "network-first",
        defaultTTLSeconds: 1,
        defaultStaleTTLSeconds: 10,
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      await handleRequest(firstEvent);

      // Advance time to make cache stale
      testContext.mock.timers.tick(1100);

      // Reset mock fetch to fail
      reset(new Map(), new Map([[url, new Error("Network error")]]));

      // Second request - should return stale cache when network fails
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      assert(secondResult, "Should return cached response");
      const secondText = await secondResult.text();

      assert.strictEqual(secondText, "Stale cached data");

      // Verify stale cached response has x-sw-cache-timestamp header
      assert.notStrictEqual(
        secondResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Stale cached response should have x-sw-cache-timestamp header"
      );

      // Reset timers
      testContext.mock.timers.reset();
    });

    test("throws error when network fails and cache is too stale", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });
      const cacheName = "test-network-first-too-stale";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that succeeds initially
      const { fetch: customFetch, reset } = createMockFetch(
        new Map([[url, new Response("Very old cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "network-first",
        defaultTTLSeconds: 1,
        defaultStaleTTLSeconds: 2,
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      await handleRequest(firstEvent);

      // Advance time to make cache too stale
      testContext.mock.timers.tick(2100);

      // Reset mock fetch to fail
      reset(new Map(), new Map([[url, new Error("Network error")]]));

      // Second request - should throw error when cache is too stale and network fails
      const secondEvent = createFetchEvent(request);
      await assert.rejects(
        async () => {
          await handleRequest(secondEvent);
        },
        { message: "Network error" }
      );
    });
  });

  describe("stale-while-revalidate strategy", () => {
    test("returns fresh cache immediately without background update", async () => {
      const cacheName = "test-swr-fresh";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([[url, new Response("Cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "stale-while-revalidate",
        defaultTTLSeconds: 300,
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      const firstResult = await handleRequest(firstEvent);
      assert(firstResult, "Should return a response");
      const firstText = await firstResult.text();
      assert.strictEqual(firstText, "Cached data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Verify network response does NOT have x-sw-cache-timestamp header
      assert.strictEqual(
        firstResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Network response should not have x-sw-cache-timestamp header"
      );

      // Second request - should return from cache without calling fetch
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      assert(secondResult, "Should return cached response");
      const secondText = await secondResult.text();

      assert.strictEqual(secondText, "Cached data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should not be called on second request"
      );

      // Verify cached response has x-sw-cache-timestamp header
      assert.notStrictEqual(
        secondResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Cached response should have x-sw-cache-timestamp header"
      );
    });

    test("returns stale cache immediately and updates in background", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-swr-stale-background";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that returns initial data
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Stale cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "stale-while-revalidate",
        defaultTTLSeconds: 1,
        defaultStaleTTLSeconds: 10,
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      await handleRequest(firstEvent);

      // Advance time to make cache stale
      testContext.mock.timers.tick(1100);

      // Reset mock fetch to return new data and reset call count
      reset(
        new Map([[url, new Response("New network data", { status: 200 })]])
      );

      // Second request - should return stale cache immediately
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      assert(secondResult, "Should return cached response");
      const secondText = await secondResult.text();

      assert.strictEqual(secondText, "Stale cached data");

      // Verify stale cached response has x-sw-cache-timestamp header
      assert.notStrictEqual(
        secondResult.headers.get("x-sw-cache-timestamp"),
        null,
        "Stale cached response should have x-sw-cache-timestamp header"
      );

      // Advance time for background update to complete
      testContext.mock.timers.tick(200);

      // Verify cache was updated in background
      const cache = await caches.open(cacheName);
      const updatedResponse = await cache.match(request);
      assert(updatedResponse, "Cache should be updated");
      const updatedText = await updatedResponse.text();
      assert.strictEqual(updatedText, "New network data");
      assert.strictEqual(
        getCallCount(),
        1, // count will be 1 because we reset the mock fetch to return different data
        "Fetch should be called in background"
      );
    });

    test("fetches from network when cache is too stale", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-swr-too-stale";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that returns initial data
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Very old cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "stale-while-revalidate",
        defaultTTLSeconds: 1,
        defaultStaleTTLSeconds: 2,
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      await handleRequest(firstEvent);

      // Advance time to make cache too stale
      testContext.mock.timers.tick(2100);

      // Reset mock fetch to return new data and reset call count
      reset(
        new Map([[url, new Response("New network data", { status: 200 })]])
      );

      // Second request - should fetch from network since cache is too stale
      const secondEvent = createFetchEvent(request);
      const secondResult = await handleRequest(secondEvent);
      const secondText = await secondResult?.text();

      assert.strictEqual(secondText, "New network data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called when cache is too stale"
      );

      // Verify cache was updated
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(request);
      assert(cachedResponse, "Cache should be updated");
      const cachedText = await cachedResponse.text();
      assert.strictEqual(cachedText, "New network data");
    });

    test("fetches from network when no cache exists", async () => {
      const cacheName = "test-swr-no-cache";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([[url, new Response("Network data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "stale-while-revalidate",
        defaultTTLSeconds: 300,
        customFetch
      });

      // First request - should fetch from network
      const event = createFetchEvent(request);
      const result = await handleRequest(event);
      assert(result, "Should return a response");
      const text = await result.text();

      assert.strictEqual(text, "Network data");
      assert.strictEqual(getCallCount(), 1, "Fetch should be called");

      // Verify cache was updated
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(request);
      assert(cachedResponse, "Cache should be updated");
    });
  });

  describe("request headers", () => {
    test("X-SW-Cache-Strategy overrides default strategy", async () => {
      const cacheName = "test-header-strategy";
      const url = "https://example.com/api/users";
      const request = new Request(url, {
        headers: {
          "X-SW-Cache-Strategy": "network-first"
        }
      });

      // Create handler with custom fetch
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Network data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      // First request - populate cache with cache-first strategy (default)
      const firstRequest = new Request(url);
      const firstEvent = createFetchEvent(firstRequest);
      await handleRequest(firstEvent);
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Reset mock fetch to return different data
      reset(
        new Map([[url, new Response("Updated network data", { status: 200 })]])
      );

      // Second request - use network-first strategy via header
      const secondEvent = createFetchEvent(request);
      const result = await handleRequest(secondEvent);
      assert(result, "Should return a response");
      const text = await result.text();

      assert.strictEqual(text, "Updated network data");
      assert.strictEqual(
        getCallCount(),
        1, // count will be 1 because we reset the mock fetch to return different data
        "Fetch should be called even with cached response"
      );
    });

    test("X-SW-Cache-TTL-Seconds overrides default TTL", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-header-ttl";
      const url = "https://example.com/api/users";
      const requestWithHeader = new Request(url, {
        headers: {
          "X-SW-Cache-TTL-Seconds": "10" // Longer TTL
        }
      });

      // Create handler with custom fetch
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([[url, new Response("Cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 1, // Short default
        customFetch
      });

      // First request - populate cache with header TTL
      const firstEvent = createFetchEvent(requestWithHeader);
      const firstResult = await handleRequest(firstEvent);
      const firstText = await firstResult?.text();
      assert.strictEqual(firstText, "Cached data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Advance time longer than default TTL but less than header TTL
      testContext.mock.timers.tick(1100);

      // Second request - should still use cache because header TTL is longer
      const secondEvent = createFetchEvent(requestWithHeader);
      const secondResult = await handleRequest(secondEvent);
      const secondText = await secondResult?.text();

      assert.strictEqual(secondText, "Cached data");
      assert.strictEqual(getCallCount(), 1, "Fetch should not be called");

      // Reset timers
      testContext.mock.timers.reset();
    });

    test("X-SW-Cache-TTL-Seconds: 0 completely opts out of caching, no network request is made by handleRequest, cache is not checked or updated.", async () => {
      const cacheName = "test-header-ttl-zero";
      const url = "https://example.com/api/users";

      // Create handler with custom fetch
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      // First request - populate cache (without TTL header)
      const firstRequest = new Request(url);
      const firstEvent = createFetchEvent(firstRequest);
      const firstResult = await handleRequest(firstEvent);
      assert(firstResult, "Should return a response");
      const firstText = await firstResult.text();
      assert.strictEqual(firstText, "Cached data");
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Verify cache was populated
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(firstRequest);
      assert(cachedResponse, "Cache should be populated");
      const cachedText = await cachedResponse.text();
      assert.strictEqual(cachedText, "Cached data");

      // Reset mock fetch to return different data
      reset(
        new Map([[url, new Response("New network data", { status: 200 })]])
      );

      // Second request - with TTL header set to 0 (should return null)
      const requestWithHeader = new Request(url, {
        headers: {
          "X-SW-Cache-TTL-Seconds": "0"
        }
      });
      const secondEvent = createFetchEvent(requestWithHeader);

      // Handler should return null (not handle the request)
      const result = await handleRequest(secondEvent);
      assert.strictEqual(result, null);

      // Verify cache is unchanged (still has original data, not new data)
      const unchangedCachedResponse = await cache.match(firstRequest);
      assert(unchangedCachedResponse, "Cache should still exist");
      const unchangedCachedText = await unchangedCachedResponse.text();
      assert.strictEqual(
        unchangedCachedText,
        "Cached data",
        "Cache should still contain original data, not new network data"
      );
      assert.strictEqual(
        getCallCount(),
        0, // count will be 0 because we reset the mock fetch to return different data
        "Fetch should not be called when TTL is 0"
      );
    });

    test("X-SW-Cache-Stale-TTL-Seconds overrides default stale TTL", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-header-stale-ttl";
      const url = "https://example.com/api/users";
      const requestWithHeader = new Request(url, {
        headers: {
          "X-SW-Cache-Stale-TTL-Seconds": "10" // Longer stale TTL
        }
      });

      // Create handler with custom fetch
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Stale cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "stale-while-revalidate",
        defaultTTLSeconds: 1,
        defaultStaleTTLSeconds: 2, // Short default stale TTL
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(requestWithHeader);
      await handleRequest(firstEvent);
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called on first request"
      );

      // Advance time longer than default stale TTL but less than header stale TTL
      testContext.mock.timers.tick(2100);

      // Reset mock fetch for background update
      reset(new Map([[url, new Response("Network data", { status: 200 })]]));

      // Second request - should still use stale cache because header stale TTL is longer
      const secondEvent = createFetchEvent(requestWithHeader);
      const result = await handleRequest(secondEvent);
      assert(result, "Result should not be null");
      const text = await result.text();

      assert.strictEqual(text, "Stale cached data");
      // Note: fetch is called in background for stale-while-revalidate
      testContext.mock.timers.tick(100);
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called in background"
      );

      // Reset timers
      testContext.mock.timers.reset();
    });

    test("X-SW-Cache-Clear clears entire cache and always goes to network", async () => {
      const cacheName = "test-header-clear";
      const url1 = "https://example.com/api/users";
      const url2 = "https://example.com/api/posts";

      // Create handler with custom fetch
      const { fetch: customFetch, reset } = createMockFetch(
        new Map([
          [url1, new Response("Users", { status: 200 })],
          [url2, new Response("Posts", { status: 200 })]
        ])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      // Populate cache with multiple entries via requests
      const firstEvent1 = createFetchEvent(new Request(url1));
      await handleRequest(firstEvent1);
      const firstEvent2 = createFetchEvent(new Request(url2));
      await handleRequest(firstEvent2);

      // Verify cache has entries
      const cache = await caches.open(cacheName);
      const keys1 = await cache.keys();
      assert.strictEqual(keys1.length, 2);

      // Reset mock fetch to return different data to verify network is called
      reset(
        new Map([
          [url1, new Response("Updated Users", { status: 200 })],
          [url2, new Response("Updated Posts", { status: 200 })]
        ])
      );

      // Request with clear header - should go to network, not use cache
      const clearRequest = new Request(url1, {
        headers: {
          "X-SW-Cache-Clear": "true"
        }
      });
      const clearEvent = createFetchEvent(clearRequest);

      const result = await handleRequest(clearEvent);
      assert(result, "Should return a response");
      const text = await result.text();

      // Verify it returned network data, not cached data
      assert.strictEqual(text, "Updated Users");

      // Verify cache is cleared
      const keys2 = await cache.keys();
      assert.strictEqual(keys2.length, 0);
    });

    test("X-SW-Cache-Clear clears cache even when network fails", async () => {
      const cacheName = "test-header-clear-offline";
      const url = "https://example.com/api/users";

      // Create handler with custom fetch
      const { fetch: customFetch, reset } = createMockFetch(
        new Map([[url, new Response("Cached data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        defaultStaleTTLSeconds: 3600,
        customFetch
      });

      // Populate cache
      const firstEvent = createFetchEvent(new Request(url));
      await handleRequest(firstEvent);

      // Verify cache has entry
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(new Request(url));
      assert(cachedResponse, "Cache should be populated");
      const cachedText = await cachedResponse.text();
      assert.strictEqual(cachedText, "Cached data");

      // Reset mock fetch to fail (simulate offline)
      reset(new Map(), new Map([[url, new Error("Network error")]]));

      // Request with clear header - should fail but still clear cache
      const clearRequest = new Request(url, {
        headers: {
          "X-SW-Cache-Clear": "true"
        }
      });
      const clearEvent = createFetchEvent(clearRequest);

      // Should throw error (not return stale cache)
      await assert.rejects(
        async () => {
          await handleRequest(clearEvent);
        },
        { message: "Network error" }
      );

      // Verify cache is still cleared even though network failed
      const keys = await cache.keys();
      assert.strictEqual(
        keys.length,
        0,
        "Cache should be cleared even when network fails"
      );
    });

    test("X-SW-Cache-Clear works with any header value", async () => {
      const cacheName = "test-header-clear-any-value";
      const url = "https://example.com/api/users";

      const { fetch: customFetch } = createMockFetch(
        new Map([[url, new Response("Users", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultTTLSeconds: 300,
        customFetch
      });

      // Populate cache
      const firstEvent = createFetchEvent(new Request(url));
      await handleRequest(firstEvent);

      // Verify cache has entry
      const cache = await caches.open(cacheName);
      let cachedResponse = await cache.match(new Request(url));
      assert(cachedResponse, "Cache should be populated");

      // Test with different header values - all should clear cache
      const values = ["true", "false", "1", "yes", "anything", ""];
      for (const value of values) {
        // Populate cache again
        await handleRequest(firstEvent);
        cachedResponse = await cache.match(new Request(url));
        assert(cachedResponse, "Cache should be populated");

        // Request with clear header using different value
        const clearRequest = new Request(url, {
          headers: {
            "X-SW-Cache-Clear": value
          }
        });
        const clearEvent = createFetchEvent(clearRequest);
        await handleRequest(clearEvent);

        // Verify cache is cleared regardless of value
        const keys = await cache.keys();
        assert.strictEqual(
          keys.length,
          0,
          `Cache should be cleared with value "${value}"`
        );
      }
    });

    test("X-SW-Cache-Invalidate invalidates specific paths", async () => {
      const cacheName = "test-header-invalidate";
      const url1 = "https://example.com/api/users";
      const url2 = "https://example.com/api/posts";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([
          [url1, new Response("Users", { status: 200 })],
          [url2, new Response("Posts", { status: 200 })]
        ])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: false, // Disable auto-invalidation for this test
        customFetch
      });

      // Populate cache via requests
      const firstEvent1 = createFetchEvent(new Request(url1));
      await handleRequest(firstEvent1);
      const firstEvent2 = createFetchEvent(new Request(url2));
      await handleRequest(firstEvent2);

      // POST request with invalidation header
      const invalidateRequest = new Request(url1, {
        method: "POST",
        headers: {
          "X-SW-Cache-Invalidate": "/api/users"
        }
      });
      const invalidateEvent = createFetchEvent(invalidateRequest);

      await handleRequest(invalidateEvent);

      // Verify specified path is invalidated
      const cache = await caches.open(cacheName);
      const cached1 = await cache.match(new Request(url1));
      assert.strictEqual(cached1, undefined, "Users should be invalidated");

      // Verify other path is still cached
      const cached2 = await cache.match(new Request(url2));
      assert(cached2, "Posts should still be cached");
    });

    test("X-SW-Cache-Invalidate headers take precedence over inferred paths when inferInvalidation is true", async () => {
      const cacheName = "test-header-invalidate-precedence";
      const url1 = "https://example.com/api/users";
      const url2 = "https://example.com/api/users/123";
      const url3 = "https://example.com/api/posts";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([
          [url1, new Response("Users list", { status: 200 })],
          [url2, new Response("User 123", { status: 200 })],
          [url3, new Response("Posts", { status: 200 })]
        ])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true, // Enable auto-invalidation
        customFetch
      });

      // Populate cache via requests
      const firstEvent1 = createFetchEvent(new Request(url1));
      await handleRequest(firstEvent1);
      const firstEvent2 = createFetchEvent(new Request(url2));
      await handleRequest(firstEvent2);
      const firstEvent3 = createFetchEvent(new Request(url3));
      await handleRequest(firstEvent3);

      // PATCH request to /api/users/123 with invalidation header
      // Inferred paths would be: /api/users/123 and /api/users
      // But header specifies only /api/users, so only that should be invalidated
      const invalidateRequest = new Request(url2, {
        method: "PATCH",
        headers: {
          "X-SW-Cache-Invalidate": "/api/users"
        }
      });
      const invalidateEvent = createFetchEvent(invalidateRequest);

      await handleRequest(invalidateEvent);

      // Verify only the header-specified path is invalidated
      const cache = await caches.open(cacheName);
      const cached1 = await cache.match(new Request(url1));
      assert.strictEqual(
        cached1,
        undefined,
        "Users list should be invalidated (header path)"
      );

      // Verify inferred paths are NOT invalidated (header takes precedence)
      const cached2 = await cache.match(new Request(url2));
      assert(cached2, "User 123 should still be cached (not inferred)");

      // Verify unrelated path is still cached
      const cached3 = await cache.match(new Request(url3));
      assert(cached3, "Posts should still be cached");
    });

    test("multiple X-SW-Cache-Invalidate headers invalidate multiple paths", async () => {
      const cacheName = "test-header-invalidate-multiple";
      const url1 = "https://example.com/api/users";
      const url2 = "https://example.com/api/posts";
      const url3 = "https://example.com/api/comments";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([
          [url1, new Response("Users", { status: 200 })],
          [url2, new Response("Posts", { status: 200 })],
          [url3, new Response("Comments", { status: 200 })]
        ])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: false,
        customFetch
      });

      // Populate cache via requests
      const firstEvent1 = createFetchEvent(new Request(url1));
      await handleRequest(firstEvent1);
      const firstEvent2 = createFetchEvent(new Request(url2));
      await handleRequest(firstEvent2);
      const firstEvent3 = createFetchEvent(new Request(url3));
      await handleRequest(firstEvent3);

      // POST request with multiple invalidation headers
      const headers = new Headers();
      headers.append("X-SW-Cache-Invalidate", "/api/users");
      headers.append("X-SW-Cache-Invalidate", "/api/posts");
      const invalidateRequest = new Request(url1, {
        method: "POST",
        headers
      });
      const invalidateEvent = createFetchEvent(invalidateRequest);

      await handleRequest(invalidateEvent);

      // Verify both paths are invalidated
      const cache = await caches.open(cacheName);
      const cached1 = await cache.match(new Request(url1));
      assert.strictEqual(cached1, undefined, "Users should be invalidated");
      const cached2 = await cache.match(new Request(url2));
      assert.strictEqual(cached2, undefined, "Posts should be invalidated");

      // Verify other path is still cached
      const cached3 = await cache.match(new Request(url3));
      assert(cached3, "Comments should still be cached");
    });
  });

  describe("mutation requests", () => {
    test("POST request triggers inferred invalidation", async () => {
      const cacheName = "test-mutation-post";
      const url = "https://example.com/api/users/123";
      const urlCollection = "https://example.com/api/users";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([
          [url, new Response("User 123", { status: 200 })],
          [urlCollection, new Response("Users list", { status: 200 })]
        ])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch
      });

      // Populate cache via GET requests
      const cache = await caches.open(cacheName);
      const firstEvent1 = createFetchEvent(new Request(url));
      await handleRequest(firstEvent1);
      const firstEvent2 = createFetchEvent(new Request(urlCollection));
      await handleRequest(firstEvent2);

      // POST request - should trigger invalidation
      const postRequest = new Request(url, { method: "POST" });
      const postEvent = createFetchEvent(postRequest);

      const { fetch: postCustomFetch } = createMockFetch(
        new Map([[url, new Response("Created", { status: 201 })]])
      );
      const handlePostRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch: postCustomFetch
      });

      await handlePostRequest(postEvent);

      // Verify inferred invalidation (exact path + parent collection)
      const cached1 = await cache.match(new Request(url));
      assert.strictEqual(
        cached1,
        undefined,
        "Exact path should be invalidated"
      );
      const cached2 = await cache.match(new Request(urlCollection));
      assert.strictEqual(
        cached2,
        undefined,
        "Parent collection should be invalidated"
      );
    });

    test("inferred invalidation works with nested paths beyond root scope", async () => {
      const cacheName = "test-mutation-nested";
      const urlItem = "https://example.com/api/v1/users/123";
      const urlCollection = "https://example.com/api/v1/users";
      const urlOtherCollection = "https://example.com/api/v1/posts";
      const urlOtherItem = "https://example.com/api/v1/posts/456";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([
          [urlItem, new Response("User 123", { status: 200 })],
          [urlCollection, new Response("Users list", { status: 200 })],
          [urlOtherCollection, new Response("Posts list", { status: 200 })],
          [urlOtherItem, new Response("Post 456", { status: 200 })]
        ])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch
      });

      // Populate cache via GET requests
      const cache = await caches.open(cacheName);
      const firstEvent1 = createFetchEvent(new Request(urlItem));
      await handleRequest(firstEvent1);
      const firstEvent2 = createFetchEvent(new Request(urlCollection));
      await handleRequest(firstEvent2);
      const firstEvent3 = createFetchEvent(new Request(urlOtherCollection));
      await handleRequest(firstEvent3);
      const firstEvent4 = createFetchEvent(new Request(urlOtherItem));
      await handleRequest(firstEvent4);

      // PATCH request to nested path - should invalidate exact path and parent collection
      const patchRequest = new Request(urlItem, { method: "PATCH" });
      const patchEvent = createFetchEvent(patchRequest);

      const { fetch: patchCustomFetch } = createMockFetch(
        new Map([[urlItem, new Response("Updated", { status: 200 })]])
      );
      const handlePatchRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch: patchCustomFetch
      });

      await handlePatchRequest(patchEvent);

      // Verify inferred invalidation (exact path + parent collection)
      const cached1 = await cache.match(new Request(urlItem));
      assert.strictEqual(
        cached1,
        undefined,
        "Exact nested path should be invalidated"
      );
      const cached2 = await cache.match(new Request(urlCollection));
      assert.strictEqual(
        cached2,
        undefined,
        "Parent collection should be invalidated"
      );

      // Verify unrelated paths are still cached
      const cached3 = await cache.match(new Request(urlOtherCollection));
      assert(cached3, "Other collection should still be cached");
      const cached4 = await cache.match(new Request(urlOtherItem));
      assert(cached4, "Other item should still be cached");
    });

    test("PUT request triggers inferred invalidation", async () => {
      const cacheName = "test-mutation-put";
      const url = "https://example.com/api/posts/456";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([[url, new Response("Post 456", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch
      });

      // Populate cache via GET request
      const cache = await caches.open(cacheName);
      const firstEvent = createFetchEvent(new Request(url));
      await handleRequest(firstEvent);

      // PUT request - should trigger invalidation
      const putRequest = new Request(url, { method: "PUT" });
      const putEvent = createFetchEvent(putRequest);

      const { fetch: putCustomFetch } = createMockFetch(
        new Map([[url, new Response("Updated", { status: 200 })]])
      );
      const handlePutRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch: putCustomFetch
      });

      await handlePutRequest(putEvent);

      // Verify inferred invalidation
      const cached = await cache.match(new Request(url));
      assert.strictEqual(cached, undefined, "Path should be invalidated");
    });

    test("DELETE request triggers inferred invalidation", async () => {
      const cacheName = "test-mutation-delete";
      const url = "https://example.com/api/comments/789";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([[url, new Response("Comment 789", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch
      });

      // Populate cache via GET request
      const cache = await caches.open(cacheName);
      const firstEvent = createFetchEvent(new Request(url));
      await handleRequest(firstEvent);

      // DELETE request - should trigger invalidation
      const deleteRequest = new Request(url, { method: "DELETE" });
      const deleteEvent = createFetchEvent(deleteRequest);

      const { fetch: deleteCustomFetch } = createMockFetch(
        new Map([[url, new Response("Deleted", { status: 200 })]])
      );
      const handleDeleteRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch: deleteCustomFetch
      });

      await handleDeleteRequest(deleteEvent);

      // Verify inferred invalidation
      const cached = await cache.match(new Request(url));
      assert.strictEqual(cached, undefined, "Path should be invalidated");
    });

    test("PATCH request invalidates cache entries with query parameters", async () => {
      const cacheName = "test-mutation-query-params";
      const urlItem = "https://example.com/api/users/456";
      const urlCollection = "https://example.com/api/users";
      const urlCollectionWithQuery = "https://example.com/api/users?org_id=123";
      const urlCollectionWithDifferentQuery =
        "https://example.com/api/users?org_id=456&status=active";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([
          [urlItem, new Response("User 456", { status: 200 })],
          [urlCollection, new Response("Users list", { status: 200 })],
          [
            urlCollectionWithQuery,
            new Response("Users list filtered", { status: 200 })
          ],
          [
            urlCollectionWithDifferentQuery,
            new Response("Users list filtered 2", { status: 200 })
          ]
        ])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch
      });

      // Populate cache via GET requests (including ones with query params)
      const cache = await caches.open(cacheName);
      const firstEvent1 = createFetchEvent(new Request(urlItem));
      await handleRequest(firstEvent1);
      const firstEvent2 = createFetchEvent(new Request(urlCollection));
      await handleRequest(firstEvent2);
      const firstEvent3 = createFetchEvent(new Request(urlCollectionWithQuery));
      await handleRequest(firstEvent3);
      const firstEvent4 = createFetchEvent(
        new Request(urlCollectionWithDifferentQuery)
      );
      await handleRequest(firstEvent4);

      // Verify all entries are cached
      const cached1 = await cache.match(new Request(urlItem));
      assert(cached1, "Item should be cached");
      const cached2 = await cache.match(new Request(urlCollection));
      assert(cached2, "Collection should be cached");
      const cached3 = await cache.match(new Request(urlCollectionWithQuery));
      assert(cached3, "Collection with query should be cached");
      const cached4 = await cache.match(
        new Request(urlCollectionWithDifferentQuery)
      );
      assert(cached4, "Collection with different query should be cached");

      // PATCH request to item - should invalidate item and all collection variants (with or without query params)
      const patchRequest = new Request(urlItem, { method: "PATCH" });
      const patchEvent = createFetchEvent(patchRequest);

      const { fetch: patchCustomFetch } = createMockFetch(
        new Map([[urlItem, new Response("Updated", { status: 200 })]])
      );
      const handlePatchRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: true,
        customFetch: patchCustomFetch
      });

      await handlePatchRequest(patchEvent);

      // Verify inferred invalidation:
      // - Exact item path should be invalidated
      const cachedItem = await cache.match(new Request(urlItem));
      assert.strictEqual(
        cachedItem,
        undefined,
        "Exact item path should be invalidated"
      );

      // - Parent collection without query params should be invalidated
      const cachedCollection = await cache.match(new Request(urlCollection));
      assert.strictEqual(
        cachedCollection,
        undefined,
        "Parent collection should be invalidated"
      );

      // - Parent collection with query params should also be invalidated
      const cachedCollectionQuery = await cache.match(
        new Request(urlCollectionWithQuery)
      );
      assert.strictEqual(
        cachedCollectionQuery,
        undefined,
        "Parent collection with query params should be invalidated"
      );

      // - Parent collection with different query params should also be invalidated
      const cachedCollectionDifferentQuery = await cache.match(
        new Request(urlCollectionWithDifferentQuery)
      );
      assert.strictEqual(
        cachedCollectionDifferentQuery,
        undefined,
        "Parent collection with different query params should be invalidated"
      );
    });

    test("inferInvalidation: false disables automatic invalidation", async () => {
      const cacheName = "test-mutation-no-infer";
      const url = "https://example.com/api/users/123";

      // Create handler with custom fetch
      const { fetch: customFetch } = createMockFetch(
        new Map([[url, new Response("User 123", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: false,
        customFetch
      });

      // Populate cache via GET request
      const cache = await caches.open(cacheName);
      const firstEvent = createFetchEvent(new Request(url));
      await handleRequest(firstEvent);

      // POST request - should NOT trigger invalidation
      const postRequest = new Request(url, { method: "POST" });
      const postEvent = createFetchEvent(postRequest);

      const { fetch: postCustomFetch } = createMockFetch(
        new Map([[url, new Response("Created", { status: 201 })]])
      );
      const handlePostRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        inferInvalidation: false,
        customFetch: postCustomFetch
      });

      await handlePostRequest(postEvent);

      // Verify cache is NOT invalidated
      const cached = await cache.match(new Request(url));
      assert(cached, "Cache should not be invalidated");
    });
  });

  describe("scope matching", () => {
    test("returns null for requests outside scope without TTL header", async () => {
      const cacheName = "test-scope-outside";
      const url = "https://example.com/other/page";
      const request = new Request(url);

      // Create handler with custom fetch that should not be called
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([[url, new Response("Should not be called", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      const event = createFetchEvent(request);
      const result = await handleRequest(event);

      assert.strictEqual(result, null);
      assert.strictEqual(getCallCount(), 0, "Fetch should not be called");
    });

    test("handles requests outside scope with TTL header", async () => {
      const cacheName = "test-scope-header-ttl";
      const url = "https://example.com/other/page";
      const request = new Request(url, {
        headers: {
          "X-SW-Cache-TTL-Seconds": "300"
        }
      });

      // Create handler with custom fetch
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([[url, new Response("Network data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      const event = createFetchEvent(request);
      const result = await handleRequest(event);
      assert(result, "Should handle request with TTL header");
      const text = await result.text();
      assert.strictEqual(text, "Network data");
      assert.strictEqual(getCallCount(), 1, "Fetch should be called");
    });

    test("handles requests matching scope", async () => {
      const cacheName = "test-scope-match";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([[url, new Response("Network data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      const event = createFetchEvent(request);
      const result = await handleRequest(event);
      assert(result, "Should handle request matching scope");
      assert.strictEqual(getCallCount(), 1, "Fetch should be called");
    });
  });

  describe("cross-origin requests", () => {
    test("returns null for cross-origin requests (different origin)", async () => {
      const cacheName = "test-cross-origin";
      const sameOriginUrl = "https://example.com/api/users";
      const crossOriginUrl = "https://otherdomain.com/api/users";

      // Mock self.location.origin to simulate service worker on example.com
      // @ts-ignore - Mocking service worker global
      const originalSelf = globalThis.self;
      // @ts-ignore
      globalThis.self = {
        location: /** @type {WorkerLocation} */ ({
          origin: "https://example.com"
        })
      };

      try {
        const { fetch: customFetch, getCallCount } = createMockFetch(
          new Map([
            [sameOriginUrl, new Response("Same origin data", { status: 200 })],
            [crossOriginUrl, new Response("Cross origin data", { status: 200 })]
          ])
        );

        const handleRequest = createHandleRequest({
          cacheName,
          scope: ["/api/"],
          defaultStrategy: "cache-first",
          defaultTTLSeconds: 300,
          customFetch
        });

        // Same-origin request should be handled
        const sameOriginRequest = new Request(sameOriginUrl);
        const sameOriginEvent = createFetchEvent(sameOriginRequest);
        const sameOriginResult = await handleRequest(sameOriginEvent);
        assert(sameOriginResult, "Same-origin request should be handled");
        assert.strictEqual(
          getCallCount(),
          1,
          "Fetch should be called for same-origin request"
        );

        // Cross-origin request should return null (not cached)
        const crossOriginRequest = new Request(crossOriginUrl);
        const crossOriginEvent = createFetchEvent(crossOriginRequest);
        const crossOriginResult = await handleRequest(crossOriginEvent);
        assert.strictEqual(
          crossOriginResult,
          null,
          "Cross-origin request should return null"
        );
        assert.strictEqual(
          getCallCount(),
          1,
          "Fetch should not be called for cross-origin request"
        );
      } finally {
        // Restore original self
        // @ts-ignore
        globalThis.self = originalSelf;
      }
    });

    test("allows same-origin requests to be cached", async () => {
      const cacheName = "test-same-origin";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Mock self.location.origin to simulate service worker on example.com
      // @ts-ignore - Mocking service worker global
      const originalSelf = globalThis.self;
      // @ts-ignore
      globalThis.self = {
        location: /** @type {WorkerLocation} */ ({
          origin: "https://example.com"
        })
      };

      try {
        const { fetch: customFetch, getCallCount } = createMockFetch(
          new Map([[url, new Response("Network data", { status: 200 })]])
        );

        const handleRequest = createHandleRequest({
          cacheName,
          scope: ["/api/"],
          defaultStrategy: "cache-first",
          defaultTTLSeconds: 300,
          customFetch
        });

        // First request - should fetch and cache
        const firstEvent = createFetchEvent(request);
        const firstResult = await handleRequest(firstEvent);
        assert(firstResult, "Same-origin request should be handled");
        assert.strictEqual(getCallCount(), 1, "Fetch should be called");

        // Second request - should return from cache
        const secondEvent = createFetchEvent(request);
        const secondResult = await handleRequest(secondEvent);
        assert(secondResult, "Should return cached response");
        assert.strictEqual(
          getCallCount(),
          1,
          "Fetch should not be called again (using cache)"
        );
      } finally {
        // Restore original self
        // @ts-ignore
        globalThis.self = originalSelf;
      }
    });
  });

  describe("non-GET requests", () => {
    test("returns null for non-GET requests (except mutations)", async () => {
      const cacheName = "test-non-get";
      const url = "https://example.com/api/users";
      const request = new Request(url, { method: "HEAD" });

      // Create handler with custom fetch that should not be called
      const { fetch: customFetch, getCallCount } = createMockFetch(
        new Map([[url, new Response("Should not be called", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      const event = createFetchEvent(request);
      const result = await handleRequest(event);

      assert.strictEqual(result, null);
      assert.strictEqual(getCallCount(), 0, "Fetch should not be called");
    });
  });

  describe("customFetch", () => {
    test("uses custom fetch function when provided", async () => {
      const cacheName = "test-custom-fetch";
      let customFetchCalled = false;
      const customFetch = async (request) => {
        customFetchCalled = true;
        return new Response("Custom fetch response", { status: 200 });
      };

      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "network-first",
        defaultTTLSeconds: 300,
        customFetch
      });

      const url = "https://example.com/api/users";
      const request = new Request(url);
      const event = createFetchEvent(request);

      const result = await handleRequest(event);
      assert(result, "Result should not be null");
      const text = await result.text();

      assert.strictEqual(text, "Custom fetch response");
      assert.strictEqual(customFetchCalled, true);
    });
  });

  describe("cache cleanup", () => {
    test("deletes entries older than maxCacheAgeSeconds reactively", async (testContext) => {
      // Enable Date mocking to control time
      testContext.mock.timers.enable({ apis: ["Date"] });

      const cacheName = "test-cleanup-reactive";
      const url = "https://example.com/api/users";
      const request = new Request(url);

      // Create handler with custom fetch that returns old data initially
      const {
        fetch: customFetch,
        getCallCount,
        reset
      } = createMockFetch(
        new Map([[url, new Response("Old data", { status: 200 })]])
      );
      const handleRequest = createHandleRequest({
        cacheName,
        scope: ["/api/"],
        defaultStrategy: "cache-first",
        defaultTTLSeconds: 0.5, // 0.5 second TTL - shorter than maxCacheAgeSeconds
        maxCacheAgeSeconds: 1, // 1 second max age
        customFetch
      });

      // First request - populate cache
      const firstEvent = createFetchEvent(request);
      await handleRequest(firstEvent);

      // Advance time for entry to exceed TTL (becomes stale) and max age
      testContext.mock.timers.tick(1100);

      // Reset mock fetch to return new data and reset call count
      reset(new Map([[url, new Response("New data", { status: 200 })]]));

      // Second request - should fetch new data and replace old entry
      // The old cache entry should be deleted reactively because it's older than maxCacheAgeSeconds
      const secondEvent = createFetchEvent(request);
      const result = await handleRequest(secondEvent);
      assert(result, "Should return a response");
      const resultText = await result.text();
      assert.strictEqual(resultText, "New data");

      // Advance time a bit for async operations to complete
      testContext.mock.timers.tick(50);

      // Verify fetch was called (cache was too old, so we fetched from network)
      assert.strictEqual(
        getCallCount(),
        1,
        "Fetch should be called when cache is too old"
      );

      // Verify old entry was deleted and replaced with new entry
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      assert(cached, "Cache should have new entry");
      const cachedText = await cached.text();
      assert.strictEqual(cachedText, "New data");

      // Reset timers
      testContext.mock.timers.reset();
    });
  });
});
