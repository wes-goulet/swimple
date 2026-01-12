// @ts-check

/**
 * Header constants used by swimple for cache control.
 * These constants can be imported in non-service-worker code to set headers on requests.
 *
 * @example
 * // Node.js / npm import
 * import { CACHE_STRATEGY_HEADER, CACHE_TTL_HEADER } from "swimple/headers";
 *
 * @example
 * // CDN import
 * import { CACHE_STRATEGY_HEADER, CACHE_TTL_HEADER } from "https://cdn.jsdelivr.net/npm/swimple@1.0.0/headers.js";
 */

/**
 * Header name for overriding the caching strategy for a specific request.
 * Values: "cache-first", "network-first", or "stale-while-revalidate"
 */
export const CACHE_STRATEGY_HEADER = "X-SW-Cache-Strategy";

/**
 * Header name for setting the time-to-live (in seconds) for a cached response.
 * Set to "0" to completely opt out of caching for a specific request.
 */
export const CACHE_TTL_HEADER = "X-SW-Cache-TTL-Seconds";

/**
 * Header name for setting the stale time-to-live (in seconds) for a cached response.
 * Used by cache-first (when offline), network-first (when offline), and stale-while-revalidate strategies.
 */
export const CACHE_STALE_TTL_HEADER = "X-SW-Cache-Stale-TTL-Seconds";

/**
 * Header name for explicitly invalidating specific cache entries.
 * Can be set multiple times to invalidate multiple paths.
 */
export const CACHE_INVALIDATE_HEADER = "X-SW-Cache-Invalidate";

/**
 * Header name for clearing the entire cache.
 * Any value works - the header's presence triggers cache clearing.
 */
export const CACHE_CLEAR_HEADER = "X-SW-Cache-Clear";

/**
 * Internal header name used to store the cache timestamp in cached responses.
 * This header is set automatically by the library and should not be set manually.
 */
export const CACHE_TIMESTAMP_HEADER = "x-sw-cache-timestamp";
