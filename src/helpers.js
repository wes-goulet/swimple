// @ts-check

// This library is meant to be called from service workers, so we include
// webworker types and exclude DOM types (which don't exist in service workers)
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference path="./typedefs.js" />

import {
  CACHE_TIMESTAMP_HEADER,
  CACHE_STRATEGY_HEADER,
  CACHE_TTL_HEADER,
  CACHE_STALE_TTL_HEADER
} from "./headers.js";

// Module-level logging state
/** @type {LoggingLevel} */
let loggingLevel = "none";

/**
 * Set the logging level
 * @param {LoggingLevel} level - Logging level: "none", "minimal", or "verbose"
 */
export function setLoggingLevel(level) {
  loggingLevel = level;
}

/**
 * Get header value (case-insensitive)
 * @param {Headers} headers
 * @param {string} name
 * @returns {string | null}
 */
export function getHeader(headers, name) {
  const lowerName = name.toLowerCase();
  // Headers is iterable in browsers, iterate through entries
  const entries = /** @type {unknown} */ (headers);
  const iterable = /** @type {Iterable<[string, string]>} */ (entries);
  for (const [key, value] of iterable) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return null;
}

/**
 * Get all header values for a given header name (case-insensitive)
 * Useful when a header has been set multiple times (e.g., multiple X-SW-Cache-Invalidate headers)
 * When headers are set multiple times with append(), they are concatenated with ", " (comma+space)
 * This function splits them back into individual values
 * @param {Headers} headers
 * @param {string} name - Header name to look up
 * @returns {string[]} Array of all header values for the given name
 */
export function getAllHeaders(headers, name) {
  const lowerName = name.toLowerCase();
  const values = [];
  // Headers is iterable in browsers, iterate through entries
  const entries = /** @type {unknown} */ (headers);
  const iterable = /** @type {Iterable<[string, string]>} */ (entries);
  for (const [key, value] of iterable) {
    if (key.toLowerCase() === lowerName) {
      // Split comma+space separated values (HTTP spec: multiple header values are comma-separated)
      // Split on ", " (comma+space) to handle concatenated values from multiple append() calls
      const splitValues = value.split(", ");
      values.push(...splitValues);
    }
  }
  return values;
}

/**
 * Get cache timestamp from response
 * @param {Response} response
 * @returns {number | null} Timestamp in milliseconds since epoch, or null if not found
 */
export function getCacheTimestamp(response) {
  const timestampHeader = getHeader(response.headers, CACHE_TIMESTAMP_HEADER);
  if (!timestampHeader) {
    return null;
  }
  const timestamp = parseInt(timestampHeader, 10);
  return isNaN(timestamp) ? null : timestamp;
}

/**
 * Check if response is fresh
 * @param {Response} response
 * @param {number} ttl - Time-to-live in seconds
 * @returns {boolean}
 */
export function isFresh(response, ttl) {
  const timestamp = getCacheTimestamp(response);
  if (timestamp === null) {
    return false;
  }
  const age = Date.now() - timestamp;
  return age < ttl * 1000;
}

/**
 * Check if response is stale (but usable)
 * @param {Response} response
 * @param {number} ttl - Time-to-live in seconds
 * @param {number | null} staleTTL - Stale time-to-live in seconds
 * @returns {boolean}
 */
export function isStale(response, ttl, staleTTL) {
  if (staleTTL === null) {
    return false;
  }
  const timestamp = getCacheTimestamp(response);
  if (timestamp === null) {
    return false;
  }
  const age = Date.now() - timestamp;
  return age >= ttl * 1000 && age < staleTTL * 1000;
}

/**
 * Add timestamp to response
 * @param {Response} response
 * @returns {Response}
 */
export function addTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set(CACHE_TIMESTAMP_HEADER, Date.now().toString());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

/**
 * Get inferred invalidation paths
 * @param {string} url
 * @returns {string[]}
 */
export function getInferredInvalidationPaths(url) {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const paths = [url]; // Exact path

  // Strip last path segment to get parent collection
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash > 0) {
    const parentPath = path.substring(0, lastSlash);
    if (parentPath) {
      const parentUrl = new URL(parentPath, urlObj.origin);
      paths.push(parentUrl.toString());
    }
  }

  return paths;
}

/**
 * Get strategy from request headers or use default
 * @param {Headers} headers
 * @param {CacheStrategy} defaultStrategy
 * @param {string} url - Request URL for logging
 * @returns {CacheStrategy}
 */
export function getStrategy(headers, defaultStrategy, url = "") {
  const strategyHeader = getHeader(headers, CACHE_STRATEGY_HEADER);
  if (
    strategyHeader &&
    ["cache-first", "network-first", "stale-while-revalidate"].includes(
      strategyHeader
    )
  ) {
    logVerbose(
      `${CACHE_STRATEGY_HEADER} header set: ${strategyHeader} (${url})`
    );
    return /** @type {CacheStrategy} */ (strategyHeader);
  }
  return defaultStrategy;
}

/**
 * Get TTL from request headers or use default
 * @param {Headers} headers
 * @param {number} defaultTTL - Default TTL in seconds
 * @param {string} url - Request URL for logging
 * @returns {number | null} TTL in seconds, or null if caching is disabled
 */
export function getTTL(headers, defaultTTL, url = "") {
  const ttlHeader = getHeader(headers, CACHE_TTL_HEADER);
  if (ttlHeader === null) {
    return defaultTTL > 0 ? defaultTTL : null;
  }
  logVerbose(`${CACHE_TTL_HEADER} header set: ${ttlHeader} (${url})`);
  const ttl = parseInt(ttlHeader, 10);
  if (isNaN(ttl) || ttl <= 0) {
    return null;
  }
  return ttl;
}

/**
 * Get stale TTL from request headers or use default
 * @param {Headers} headers
 * @param {number} defaultStaleTTL - Default stale TTL in seconds
 * @param {string} url - Request URL for logging
 * @returns {number | null} Stale TTL in seconds, or null if stale caching is disabled
 */
export function getStaleTTL(headers, defaultStaleTTL, url = "") {
  const staleTTLHeader = getHeader(headers, CACHE_STALE_TTL_HEADER);
  if (staleTTLHeader === null) {
    return defaultStaleTTL > 0 ? defaultStaleTTL : null;
  }
  logVerbose(
    `${CACHE_STALE_TTL_HEADER} header set: ${staleTTLHeader} (${url})`
  );
  const staleTTL = parseInt(staleTTLHeader, 10);
  if (isNaN(staleTTL) || staleTTL <= 0) {
    return null;
  }
  return staleTTL;
}

/**
 * Check if URL matches scope.  Returns true if scope array is empty or if the URL pathname starts with any of the scope prefixes.
 * @param {string} url
 * @param {string[]} scope
 * @param {number} defaultTTLSeconds
 * @returns {boolean}
 */
export function matchesScope(url, scope, defaultTTLSeconds) {
  if (scope.length === 0) {
    return defaultTTLSeconds > 0;
  }
  const urlObj = new URL(url);
  return scope.some((prefix) => urlObj.pathname.startsWith(prefix));
}

/**
 * Invalidate cache entries
 * Matches cache entries by pathname (ignoring query parameters), so invalidating
 * "/api/users" will also invalidate "/api/users?org_id=123" and other query variants.
 * @param {string} cacheName
 * @param {string[]} urls
 * @returns {Promise<void>}
 */
export async function invalidateCache(cacheName, urls) {
  const cache = await caches.open(cacheName);
  const deletePromises = [];
  const invalidatedUrls = [];

  // Determine origin for constructing full URLs from relative paths
  // Try self.location.origin first (service worker context)
  // Otherwise, extract from URLs array if any are full URLs
  let cacheOrigin = null;
  if (typeof self !== "undefined" && self.location && self.location.origin) {
    cacheOrigin = self.location.origin;
  } else {
    // Try to extract origin from URLs array
    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        cacheOrigin = urlObj.origin;
        break; // Use first valid origin found
      } catch {
        // Not a full URL, continue
      }
    }
  }

  if (!cacheOrigin) {
    throw new Error(
      "Cannot determine origin for relative paths. self.location.origin is not available and no full URLs provided."
    );
  }

  // Iterate over URLs to invalidate (typically much smaller than cache size)
  // Use matchAll with ignoreSearch to avoid loading all cache keys into memory
  for (const url of urls) {
    try {
      // Create a Request object for matching
      // If URL is relative, construct a full URL using the cache origin
      let requestUrl = url;
      try {
        // Try to parse as URL - if it fails, it might be relative
        new URL(url);
      } catch {
        // If relative, construct a full URL
        requestUrl = new URL(url, cacheOrigin).toString();
      }

      // Create a GET request for matching (cached entries are always GET requests)
      const request = new Request(requestUrl, { method: "GET" });

      // Use matchAll with ignoreSearch to find all cache entries matching this pathname
      // (ignoring query parameters). This avoids loading all cache keys into memory.
      const matchingResponses = await cache.matchAll(request, {
        ignoreSearch: true
      });

      // Delete all matching entries
      // matchAll returns Response objects; construct Request objects for delete()
      for (const response of matchingResponses) {
        const responseUrl = response.url;
        const requestToDelete = new Request(responseUrl);
        deletePromises.push(cache.delete(requestToDelete));
        invalidatedUrls.push(responseUrl);
      }
    } catch (error) {
      // If URL parsing or matching fails, try exact match as fallback
      try {
        const request = new Request(url);
        const deleted = await cache.delete(request);
        if (deleted) {
          invalidatedUrls.push(url);
        }
      } catch {
        // Ignore errors for invalid URLs
      }
    }
  }

  await Promise.allSettled(deletePromises);

  // Log each invalidated URL
  invalidatedUrls.forEach((url) => {
    logInfo(`Cache invalidated: ${url}`);
  });
}

/**
 * Clear entire cache
 * @param {string} cacheName
 * @returns {Promise<void>}
 */
export async function clearCache(cacheName) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.allSettled(keys.map((request) => cache.delete(request)));
}

/**
 * Check if a cached response is older than the maximum age
 * @param {Response} response
 * @param {number} maxAgeSeconds - Maximum age in seconds
 * @returns {boolean}
 */
export function isOlderThanMaxAge(response, maxAgeSeconds) {
  const timestamp = getCacheTimestamp(response);
  if (timestamp === null) {
    return false;
  }
  const age = Date.now() - timestamp;
  return age >= maxAgeSeconds * 1000;
}

/**
 * Clean up cache entries older than maxAgeSeconds
 * @param {string} cacheName
 * @param {number} maxAgeSeconds - Maximum age in seconds
 * @returns {Promise<void>}
 */
export async function cleanupOldCacheEntries(cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const cleanupPromises = [];
  const cleanedUrls = [];

  for (const request of keys) {
    const response = await cache.match(request);
    if (response && isOlderThanMaxAge(response, maxAgeSeconds)) {
      const url = request.url || request.toString();
      cleanedUrls.push(url);
      cleanupPromises.push(cache.delete(request));
    }
  }

  await Promise.allSettled(cleanupPromises);
  if (cleanedUrls.length > 0) {
    cleanedUrls.forEach((url) => {
      logVerbose(`Cache entry cleaned up (maxAge): ${url}`);
    });
    logVerbose(
      `Cleaned up ${cleanedUrls.length} cache entr${cleanedUrls.length === 1 ? "y" : "ies"} due to maxAge`
    );
  }
}

/**
 * Log an informational message (minimal and verbose levels)
 * @param {string} message - Message to log
 */
export function logInfo(message) {
  if (loggingLevel === "minimal" || loggingLevel === "verbose") {
    console.info(`[swimple] ${message}`);
  }
}

/**
 * Log a verbose message (verbose level only)
 * @param {string} message - Message to log
 */
export function logVerbose(message) {
  if (loggingLevel === "verbose") {
    console.debug(`[swimple] ${message}`);
  }
}

/**
 * Validate configuration object
 * @param {HandleRequestConfig} config - Configuration object to validate
 * @throws {Error} If config is invalid
 */
export function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("config is required and must be an object");
  }
  const cfg = config;
  if (!cfg.cacheName || typeof cfg.cacheName !== "string") {
    throw new Error("config.cacheName is required and must be a string");
  }
  if (
    cfg.defaultStrategy &&
    !["cache-first", "network-first", "stale-while-revalidate"].includes(
      String(cfg.defaultStrategy)
    )
  ) {
    throw new Error(
      "config.defaultStrategy must be one of: 'cache-first', 'network-first', 'stale-while-revalidate'"
    );
  }
  if (cfg.customFetch !== undefined && typeof cfg.customFetch !== "function") {
    throw new Error("config.customFetch must be a function");
  }
  if (
    cfg.maxCacheAgeSeconds !== undefined &&
    (typeof cfg.maxCacheAgeSeconds !== "number" || cfg.maxCacheAgeSeconds <= 0)
  ) {
    throw new Error(
      "config.maxCacheAgeSeconds must be a positive number if provided"
    );
  }
  if (
    cfg.loggingLevel !== undefined &&
    !["none", "minimal", "verbose"].includes(String(cfg.loggingLevel))
  ) {
    throw new Error(
      'config.loggingLevel must be one of: "none", "minimal", "verbose"'
    );
  }
}
