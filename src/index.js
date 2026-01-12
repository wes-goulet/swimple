// @ts-check

// This library is meant to be called from service workers, so we include
// webworker types and exclude DOM types (which don't exist in service workers)
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference path="./typedefs.js" />

import {
  getHeader,
  getAllHeaders,
  isFresh,
  isStale,
  addTimestamp,
  getInferredInvalidationPaths,
  getStrategy,
  getTTL,
  getStaleTTL,
  matchesScope,
  invalidateCache,
  clearCache,
  validateConfig,
  isOlderThanMaxAge,
  cleanupOldCacheEntries,
  setLoggingLevel,
  logInfo,
  logVerbose
} from "./helpers.js";
import {
  CACHE_CLEAR_HEADER,
  CACHE_INVALIDATE_HEADER,
  CACHE_TTL_HEADER
} from "./headers.js";

/**
 * Creates a request handler function for service worker fetch events.
 * The handler implements HTTP caching with configurable strategies (cache-first, network-first, stale-while-revalidate),
 * automatic cache invalidation for mutations, and periodic cache cleanup. Only handles same-origin GET requests
 * that match the configured scope.
 *
 * @param {HandleRequestConfig} config - Configuration options including cache name, scope, default strategy, and TTL settings
 * @returns {(event: FetchEvent) => Promise<Response> | null} Request handler function that can be used in service worker fetch event listeners
 */
export function createHandleRequest(config) {
  validateConfig(config);

  // Set defaults
  const cacheName = config.cacheName;
  const scope = config.scope || [];
  const defaultStrategy = /** @type {CacheStrategy} */ (
    config.defaultStrategy || "cache-first"
  );
  const defaultTTLSeconds = config.defaultTTLSeconds ?? 300;
  const defaultStaleTTLSeconds = config.defaultStaleTTLSeconds ?? 3600;
  const maxCacheAgeSeconds = config.maxCacheAgeSeconds ?? 7200;
  const inferInvalidation = config.inferInvalidation ?? true;
  const customFetch = config.customFetch || fetch;
  const loggingLevel = config.loggingLevel ?? "none";

  // Set module-level logging state
  setLoggingLevel(loggingLevel);

  // Track fetch counter for periodic cleanup
  let fetchCounter = 0;

  /**
   * Service worker fetch event handler that implements HTTP caching strategies.
   * Handles cache invalidation for mutations, implements cache-first/network-first/stale-while-revalidate
   * strategies for GET requests, and performs automatic cache cleanup.
   *
   * @param {FetchEvent} event - The fetch event from the service worker
   * @returns {Promise<Response> | null} The cached or fetched response, or null if request shouldn't be handled
   */
  return function handleRequest(event) {
    const request = event.request;
    const url = request.url;
    const method = request.method;
    const headers = request.headers;

    // Handle cache clearing - header presence (any value) triggers cache clear
    if (getHeader(headers, CACHE_CLEAR_HEADER) !== null) {
      logVerbose(`${CACHE_CLEAR_HEADER} header set: ${url}`);
      return (async () => {
        await clearCache(cacheName);
        return customFetch(request);
      })();
    }

    // Handle invalidation for mutations
    // Check for explicit invalidation headers first (works even if inferInvalidation is false)
    const invalidateHeaders = getAllHeaders(headers, CACHE_INVALIDATE_HEADER);
    const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(method);

    if (invalidateHeaders.length > 0) {
      invalidateHeaders.forEach((path) => {
        logVerbose(`${CACHE_INVALIDATE_HEADER} header set: ${path} (${url})`);
      });
    }

    if (invalidateHeaders.length > 0 || (inferInvalidation && isMutation)) {
      return (async () => {
        let pathsToInvalidate = [...invalidateHeaders];

        // Only add inferred paths if no explicit headers were provided
        // Headers take precedence over inferred paths
        if (pathsToInvalidate.length === 0 && inferInvalidation && isMutation) {
          pathsToInvalidate.push(...getInferredInvalidationPaths(url));
        }

        // Normalize relative paths to full URLs using the mutation request's origin
        if (pathsToInvalidate.length > 0) {
          try {
            const requestUrlObj = new URL(url);
            const requestOrigin = requestUrlObj.origin;
            pathsToInvalidate = pathsToInvalidate.map((path) => {
              try {
                // Try to parse as URL - if it fails, it's relative
                new URL(path);
                return path; // Already a full URL
              } catch {
                // Relative path - construct full URL using request origin
                return new URL(path, requestOrigin).toString();
              }
            });
          } catch {
            // If we can't parse the request URL, leave paths as-is
            // invalidateCache will handle it
          }
          await invalidateCache(cacheName, pathsToInvalidate);
        }

        return customFetch(request);
      })();
    }

    // Only handle GET requests
    if (method !== "GET") {
      return null;
    }

    // Only cache same-origin requests - cross-origin requests are not cached
    // In service worker context, self.location.origin is the service worker's origin
    try {
      const requestUrl = new URL(url);
      // Check if we're in a service worker context and can determine the origin
      if (
        typeof self !== "undefined" &&
        self.location &&
        self.location.origin
      ) {
        const serviceWorkerOrigin = self.location.origin;
        // If request origin doesn't match service worker origin, don't cache
        if (requestUrl.origin !== serviceWorkerOrigin) {
          return null;
        }
      }
      // In test environments where self.location might not be available,
      // we rely on the test setup to ensure proper origin handling
    } catch (error) {
      // If URL parsing fails, don't cache
      return null;
    }

    // Periodic cleanup: run on first fetch and every 100 fetches
    fetchCounter++;
    if (fetchCounter === 1 || fetchCounter % 100 === 0) {
      // Run cleanup asynchronously, don't block the fetch
      cleanupOldCacheEntries(cacheName, maxCacheAgeSeconds).catch(() => {
        // Ignore cleanup errors
      });
      if (fetchCounter % 100 === 0) {
        fetchCounter = 1; // Reset to 1 after cleanup, not 0
      }
    }

    // Check if request matches scope and should be cached
    const hasExplicitTTLHeader = getHeader(headers, CACHE_TTL_HEADER) !== null;
    const ttl = getTTL(headers, defaultTTLSeconds, url);

    // If scope doesn't match and there's no explicit TTL header, don't handle the request
    if (!matchesScope(url, scope, defaultTTLSeconds) && !hasExplicitTTLHeader) {
      return null;
    }

    // If TTL is 0 or null, don't cache
    if (ttl === null || ttl === 0) {
      return null;
    }

    const staleTTL = getStaleTTL(headers, defaultStaleTTLSeconds, url);
    const strategy = getStrategy(headers, defaultStrategy, url);

    // Handle cache-first strategy
    if (strategy === "cache-first") {
      return (async () => {
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);

        if (cachedResponse) {
          if (isFresh(cachedResponse, ttl)) {
            logInfo(`Cache hit: ${url}`);
            return cachedResponse;
          }

          // Reactive cleanup: delete if older than maxCacheAgeSeconds
          if (isOlderThanMaxAge(cachedResponse, maxCacheAgeSeconds)) {
            logVerbose(`Cache entry cleaned up (maxAge): ${url}`);
            await cache.delete(request); // Fire-and-forget cleanup
          }
        }

        // No fresh cache, fetch from network
        if (!cachedResponse) {
          logVerbose(`Cache miss: ${url}`);
        } else if (!isStale(cachedResponse, ttl, staleTTL)) {
          logVerbose(`Cache miss (stale): ${url}`);
        }
        let networkResponse;
        try {
          networkResponse = await customFetch(request);
        } catch (error) {
          // Network failed, return stale cache if available
          if (cachedResponse && isStale(cachedResponse, ttl, staleTTL)) {
            logInfo(`Cache hit (stale, offline): ${url}`);
            return cachedResponse;
          }
          throw error;
        }

        // Cache the response if successful
        if (networkResponse.ok) {
          const responseToCache = addTimestamp(networkResponse.clone());
          await cache.put(request, responseToCache);
        }
        return networkResponse;
      })();
    }

    // Handle network-first strategy
    if (strategy === "network-first") {
      return (async () => {
        const cache = await caches.open(cacheName);

        let networkResponse;
        try {
          networkResponse = await customFetch(request);
        } catch (error) {
          // Network failed, try cache
          const cachedResponse = await cache.match(request);
          if (cachedResponse) {
            // Reactive cleanup: delete if older than maxCacheAgeSeconds
            if (isOlderThanMaxAge(cachedResponse, maxCacheAgeSeconds)) {
              logVerbose(`Cache entry cleaned up (maxAge): ${url}`);
              cache.delete(request); // Fire-and-forget cleanup
              throw error;
            }
            if (
              isFresh(cachedResponse, ttl) ||
              isStale(cachedResponse, ttl, staleTTL)
            ) {
              logInfo(`Cache hit (offline): ${url}`);
              return cachedResponse;
            }
          }
          logVerbose(`Cache miss (offline): ${url}`);
          throw error;
        }

        // Cache the response if successful
        if (networkResponse.ok) {
          const responseToCache = addTimestamp(networkResponse.clone());
          await cache.put(request, responseToCache);
        }
        return networkResponse;
      })();
    }

    // Handle stale-while-revalidate strategy
    if (strategy === "stale-while-revalidate") {
      return (async () => {
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);

        if (cachedResponse) {
          // Reactive cleanup: delete if older than maxCacheAgeSeconds
          if (isOlderThanMaxAge(cachedResponse, maxCacheAgeSeconds)) {
            logVerbose(`Cache entry cleaned up (maxAge): ${url}`);
            cache.delete(request); // Fire-and-forget cleanup
            // Continue to fetch from network
          } else {
            const fresh = isFresh(cachedResponse, ttl);
            const stale = isStale(cachedResponse, ttl, staleTTL);

            if (fresh || stale) {
              if (fresh) {
                logInfo(`Cache hit: ${url}`);
              } else {
                logInfo(`Cache hit (stale): ${url}`);
              }
              // Return cached response immediately
              // Update cache in background if stale
              if (stale) {
                customFetch(request)
                  .then((networkResponse) => {
                    if (networkResponse.ok) {
                      const responseToCache = addTimestamp(
                        networkResponse.clone()
                      );
                      cache.put(request, responseToCache);
                    }
                  })
                  .catch(() => {
                    // Ignore background update errors
                  });
              }
              return cachedResponse;
            }
          }
        }

        // No cache or too stale, fetch from network, no need for fallback if offline
        // because we already know if there was a cached response it won't be
        // fresh or stale if we've reached this point
        if (!cachedResponse) {
          logVerbose(`Cache miss: ${url}`);
        } else {
          logVerbose(`Cache miss (too stale): ${url}`);
        }
        const networkResponse = await customFetch(request);

        // Cache the response if successful
        if (networkResponse.ok) {
          const responseToCache = addTimestamp(networkResponse.clone());
          await cache.put(request, responseToCache);
        }
        return networkResponse;
      })();
    }

    return null;
  };
}

// Export cleanup function for manual use
export { cleanupOldCacheEntries } from "./helpers.js";
