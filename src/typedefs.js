// @ts-check

/**
 * Caching strategy for handling requests.
 * - `cache-first`: Return from cache if fresh (within TTL), otherwise fetch from network immediately. Stale cache is only used when offline (network request fails). No background updates.
 * - `network-first`: Try network first, fall back to stale cache if offline (within stale TTL). Cache updated when network succeeds.
 * - `stale-while-revalidate`: Return from cache immediately (fresh = no update, stale = update in background). Fetch from network if too stale or missing.
 * @typedef {"cache-first" | "network-first" | "stale-while-revalidate"} CacheStrategy
 */

/**
 * Logging level for cache operations.
 * - `none`: No logging
 * - `minimal`: Logs cache hits and cache invalidation only
 * - `verbose`: Logs all events including cache misses, cleanup, and header usage
 * @typedef {"none" | "minimal" | "verbose"} LoggingLevel
 */

/**
 * @typedef HandleRequestConfig
 * @property {string} cacheName - Name of the cache, used when calling `Cache.open(cacheName)` internally. Changing this name effectively clears the previous cache entries.
 * @property {string[]} [scope] - URL prefixes to cache by default (e.g., `['/api/']`). If not set and `defaultTTLSeconds` is set, all same-origin GET requests are cached automatically. If not set and `defaultTTLSeconds` is not set (or 0), no requests are cached by default. Individual requests outside the scope can still enable caching with `X-SW-Cache-TTL-Seconds` header. Note: Cross-origin requests are never cached, regardless of scope or TTL headers.
 * @property {CacheStrategy} [defaultStrategy] - Default caching strategy: `'cache-first'`, `'network-first'`, or `'stale-while-revalidate'`.
 * @property {number} [defaultTTLSeconds] - Maximum age for fresh content. Fresh content will be returned from cache for cache-first and stale-while-revalidate strategies, and also from network-first when offline. Fresh content does not get updated from the network. Since this defaults to `300`, caching is automatic by default for GET requests matching the scope. Set to `0` or `undefined` to disable automatic caching (individual requests can still enable caching with `X-SW-Cache-TTL-Seconds` header).
 * @property {number} [defaultStaleTTLSeconds] - Maximum age for stale content. Stale content will be returned from cache for cache-first (when offline), network-first (when offline), and stale-while-revalidate strategies. That means responses past the fresh TTL but within stale TTL can still be returned from cache. Stale content does get updated from the network.
 * @property {boolean} [inferInvalidation] - Automatically invalidate cache on POST/PATCH/PUT/DELETE requests.
 * @property {typeof fetch} [customFetch] - Custom fetch function to use for network requests. Receives a `Request` object and must return a `Promise<Response>`. Useful for handling authentication errors (401/403) or adding custom headers to all requests.
 * @property {number} [maxCacheAgeSeconds] - Maximum age (in seconds) before cache entries are automatically cleaned up. Entries older than this age are deleted. Defaults to 7200 seconds (2 hours, which is 2x the default stale TTL). Cache entries are cleaned up reactively (when accessed) and periodically (every 100 fetches).
 * @property {LoggingLevel} [loggingLevel] - Logging level: "none" (no logging), "minimal" (cache hits and invalidation only), or "verbose" (all logging including misses, cleanup, and headers). Defaults to "none".
 */
