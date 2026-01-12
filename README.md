# swimple

A simple service worker library for request caching.

## Features

- ⚡ **Low Configuration**: Request caching with automatic invalidation by default - minimal setup required
- 🔄 **Smart Invalidation**: Automatically invalidate cache on mutations (POST/PATCH/PUT/DELETE)
- 🎛️ **Flexible Strategies**: Support for cache-first, network-first, and stale-while-revalidate
- 🪶 **Lightweight**: Single-purpose library with no dependencies
- 🚀 **Modern**: Designed for ES module service workers (supported by all modern browsers as of January 2026)
- 🔧 **Configurable**: Automatic caching by default, with per-request control

## Installation

### Direct CDN Import (Recommended)

```javascript
// sw.js
import { createHandleRequest } from "https://cdn.jsdelivr.net/npm/swimple@1.0.0/index.js";
```

### NPM Install

```bash
npm install swimple
```

```javascript
// sw.js
import { createHandleRequest } from "swimple";
```

## Quick Start

> NOTE: This documentation focuses on modern browsers with module service workers support. If you aren't using module service workers, you can probably still use this with `importScripts` but I'll leave that to you to figure out.

### 1. Register Your Service Worker

```javascript
// in javascript in index.html (or app.js or main.js or whatever frameworks use nowadays)
try {
  await navigator.serviceWorker.register("/sw.js", { type: "module" });
} catch (error) {
  console.error("Error registering module service worker:", error);
}
```

### 2. Set Up Request Handler in Service Worker

```javascript
// sw.js
import { createHandleRequest } from "https://cdn.jsdelivr.net/npm/swimple@1.0.0/index.js";

// create the request handler
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"] // this means only GET requests that start with /api/ will be cached
});

self.addEventListener("fetch", (event) => {
  const response = handleRequest(event);

  if (response) {
    event.respondWith(response);
    return;
  }

  // fall through to other logic or just let the request go to network by doing nothing
  return;
});
```

That's it! Your service worker will now cache GET requests that start with `/api/` using the default TTL of 300 seconds. Subsequent requests to the same path will return from the cache if the response is fresh (within the TTL). Any mutations (POST/PATCH/PUT/DELETE) will invalidate the cache. For example a PATCH request to `/api/users/123` will invalidate the cache for `/api/users/123` (ie: the details of that user) and `/api/users` (ie: the list of users that likely includes that user).

Any requests outside the scope (ie: not starting with `/api/`) won't be processed by the cache handler (it will return null).

## Configuring the request handler

If you want to use different defaults for all requests, you can pass in a config object to the `createHandleRequest` function.

### Example 1: Network-First Strategy

```javascript
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  defaultStrategy: "network-first"
});
```

With network-first, requests always try the network first (even if cached and fresh). If the network fails and you're offline, it will return a cached response (if available and within the fresh or stale TTL). The cache is updated in the background when the network succeeds. This is useful when you want the latest data from the network when online, but still work offline with cached data.

### Example 2: Stale-While-Revalidate Strategy

```javascript
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  defaultStrategy: "stale-while-revalidate"
});
```

With stale-while-revalidate, requests return from cache immediately if available. If the cache is fresh (within 300 seconds), it's returned without updating. If the cache is stale (past the fresh TTL but within the stale TTL of 3600 seconds), the stale response is returned immediately and the cache is updated in the background. If the cache is too stale (past the stale TTL) or missing, it fetches from network. This provides instant responses while keeping data fresh in the background.

### Example 3: Skip Inferring Invalidations

```javascript
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  inferInvalidation: false
});
```

With inferInvalidation set to false, the library will not automatically invalidate the cache on mutation requests. You will need to manually invalidate the cache on mutation requests using the `X-SW-Cache-Invalidate` header.

```javascript
fetch("/api/users/123", {
  method: "PATCH",
  headers: {
    "X-SW-Cache-Invalidate": "/api/users/123"
  }
});
```

If you need to invalidate multiple paths at once, you can set the `X-SW-Cache-Invalidate` header multiple times in a single request.

```javascript
const headers = new Headers();
headers.append("X-SW-Cache-Invalidate", "/api/users");
headers.append("X-SW-Cache-Invalidate", "/api/users/123");

fetch("/api/users/123", {
  method: "PATCH",
  headers
});
```

### Example 4: Custom Fetch Function

You can provide a custom fetch function to intercept and modify requests/responses. This is useful for handling authentication errors (e.g., 401/403 responses) or adding custom headers to all requests.

```javascript
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  customFetch: async (request) => {
    const response = await fetch(request);

    // Handle authentication errors
    if (response.status === 401 || response.status === 403) {
      // redirect to login page
      // ...
    }

    return response;
  }
});
```

The `customFetch` function has the same signature as the native `fetch` function. It will be used for all network requests made by the cache handler.

### Example 5: Enable Logging

You can enable logging to debug cache behavior. The library supports three logging levels:

- `"none"` (default): No logging
- `"minimal"`: console.info logs cache hits and cache invalidation only
- `"verbose"`: console.debug logs all events including cache misses, header usage, and cleanup

```javascript
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  loggingLevel: "verbose" // or "minimal" for less verbose output
});
```

With `loggingLevel: "minimal"`, you'll see:

```
[swimple] Cache hit: https://example.com/api/users
[swimple] Cache invalidated: https://example.com/api/users/123
```

With `loggingLevel: "verbose"`, you'll see all events:

```
[swimple] Cache hit: https://example.com/api/users
[swimple] Cache miss: https://example.com/api/posts
[swimple] X-SW-Cache-TTL-Seconds header set: 600 (https://example.com/api/users)
[swimple] Cache invalidated: https://example.com/api/users/123
[swimple] Cache entry cleaned up (maxAge): https://example.com/api/old-data
```

This is useful for debugging cache behavior and understanding when requests are served from cache vs. network.

## Clearing the cache on logout

It can be useful to clear the cache on logout or other events. You can do this by setting the `X-SW-Cache-Clear` header on a request (any value will work - the header's presence triggers cache clearing).

```javascript
fetch("/api/logout", {
  method: "POST",
  headers: {
    "X-SW-Cache-Clear": "true" // Any value works - header presence triggers cache clear
  }
});
```

This will clear the entire cache for the cache name specified in the request handler configuration.

## Automatic Cache Cleanup

The library automatically cleans up cache entries that are older than `maxCacheAgeSeconds` (defaults to 7200 seconds). This prevents unbounded cache growth.

Cleanup happens in two ways:

1. **Reactive cleanup**: When a cached entry is accessed and found to be older than `maxCacheAgeSeconds`, it's immediately deleted.
2. **Periodic cleanup**: Every 100 fetches, the library scans the cache and removes all entries older than `maxCacheAgeSeconds`.

If the service worker restarts (which can happen at any time), cleanup runs again on the first fetch after restart, ensuring cleanup happens even if the service worker restarts frequently.

### Manual Cleanup

You can also manually trigger cleanup in your service worker's `activate` handler:

```javascript
// sw.js
import { cleanupOldCacheEntries } from "https://cdn.jsdelivr.net/npm/swimple@1.0.0/index.js";

self.addEventListener("activate", (event) => {
  event.waitUntil(
    cleanupOldCacheEntries("api-cache-v1", 7200) // cacheName, maxAgeSeconds
  );
});
```

## Understanding Fresh vs Stale TTL

- **Fresh TTL** (`defaultTTLSeconds`): Responses within this time are considered "fresh". For `cache-first` and `stale-while-revalidate` strategies, fresh responses are returned from cache without background network updates.

- **Stale TTL** (`defaultStaleTTLSeconds`): Responses past the fresh TTL but within the stale TTL are considered "stale". Stale responses can still be returned from cache:
  - For `cache-first`: Used as a fallback when offline
  - For `network-first`: Used as a fallback when offline
  - For `stale-while-revalidate`: Returned immediately while updating in the background

If a response is past the stale TTL (or no stale TTL is set), it's too stale and must be fetched from the network.

## API Reference

### `createHandleRequest(config)`

Creates a request handler function for your service worker fetch handler.

#### Configuration Options

| Option                   | Type       | Required | Default         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------- | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheName`              | `string`   | Yes      | -               | Name of the cache, used when calling `Cache.open(cacheName)` internally. Changing this name effectively clears the previous cache entries.                                                                                                                                                                                                                                                                                                                                    |
| `scope`                  | `string[]` | No       | `undefined`     | URL prefixes to cache by default (e.g., `['/api/']`). If not set and `defaultTTLSeconds` is set, all same-origin GET requests are cached automatically. If not set and `defaultTTLSeconds` is not set (or 0), no requests are cached by default. Individual requests outside the scope can still enable caching with `X-SW-Cache-TTL-Seconds` header. **Note:** Cross-origin requests are never cached, regardless of scope or TTL headers.                                   |
| `defaultStrategy`        | `string`   | No       | `'cache-first'` | Default caching strategy: `'cache-first'`, `'network-first'`, or `'stale-while-revalidate'`.                                                                                                                                                                                                                                                                                                                                                                                  |
| `defaultTTLSeconds`      | `number`   | No       | `300`           | Maximum age for fresh content. Fresh content will be returned from cache for cache-first and stale-while-revalidate strategies, and also from network-first when offline. Fresh content does not get updated from the network. Since this defaults to `300`, caching is automatic by default for GET requests matching the scope. Set to `0` or `undefined` to disable automatic caching (individual requests can still enable caching with `X-SW-Cache-TTL-Seconds` header). |
| `defaultStaleTTLSeconds` | `number`   | No       | `3600`          | Maximum age for stale content. Stale content will be returned from cache for cache-first (when offline), network-first (when offline), and stale-while-revalidate strategies. That means responses past the fresh TTL but within stale TTL can still be returned from cache. Stale content does get updated from the network.                                                                                                                                                 |
| `inferInvalidation`      | `boolean`  | No       | `true`          | Automatically invalidate cache on POST/PATCH/PUT/DELETE requests.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `customFetch`            | `function` | No       | `fetch`         | Custom fetch function to use for network requests. Receives a `Request` object and must return a `Promise<Response>`. Useful for handling authentication errors (401/403) or adding custom headers to all requests.                                                                                                                                                                                                                                                           |
| `maxCacheAgeSeconds`     | `number`   | No       | `7200`          | Maximum age (in seconds) before cache entries are automatically cleaned up. Entries older than this age are deleted. Defaults to 7200 seconds (2 hours, which is 2x the default stale TTL). Cache entries are cleaned up reactively (when accessed) and periodically (every 100 fetches).                                                                                                                                                                                     |
| `loggingLevel`           | `string`   | No       | `"none"`        | Logging level: `"none"` (no logging), `"minimal"` (cache hits and invalidation only), or `"verbose"` (all logging including misses, header usage, and cleanup). When enabled, logs are written to the console with the `[swimple]` prefix. Useful for debugging cache behavior.                                                                                                                                                                                               |

#### Returns

A request handler function `(event: FetchEvent) => Promise<Response> | null` that:

- Returns a `Promise<Response>` if the request is handled by the cache handler
- Returns `null` if the request should fall through to other handlers (e.g., when `X-SW-Cache-TTL-Seconds` is set to `0`, or when the request doesn't match the configured scope and has no TTL header)

## HTTP Headers

Control caching behavior on a per-request basis using these headers:

### `X-SW-Cache-Strategy`

Override the default caching strategy for a specific request.

**Values:**

- `cache-first` - Return from cache if fresh (within TTL), otherwise fetch from network immediately. Stale cache is only used when offline (network request fails). No background updates.
- `network-first` - Try network first, fall back to stale cache if offline (within stale TTL). Cache updated when network succeeds.
- `stale-while-revalidate` - Return from cache immediately (fresh = no update, stale = update in background). Fetch from network if too stale or missing.

**Example:**

```javascript
fetch("/api/users", {
  headers: {
    "X-SW-Cache-Strategy": "network-first"
  }
});
```

### `X-SW-Cache-TTL-Seconds`

Set the time-to-live (in seconds) used to validate a cached response when it's requested. The TTL is not stored with the cached response; only the timestamp of when it was cached is stored. Each request can specify a different TTL to use for validation.

**Example:**

```javascript
fetch("/api/users", {
  headers: {
    "X-SW-Cache-TTL-Seconds": "600" // Cache for 10 minutes
  }
});
```

To completely opt out of caching for a specific request (the handler will return `null` and not process the request at all):

```javascript
fetch("/api/random", {
  headers: {
    "X-SW-Cache-TTL-Seconds": "0" // Handler returns null
  }
});
```

**Important:** Setting TTL to `0` is a complete opt-out. The handler returns `null` immediately without checking cache, making network requests, or processing the request in any way.

### `X-SW-Cache-Stale-TTL-Seconds`

Maximum age before a cache entry is considered too stale to use. Used by `cache-first` (when offline), `network-first` (when offline) and `stale-while-revalidate` strategies.

**How it works:**

- **Fresh** (within TTL): Return from cache without background update
- **Stale** (past TTL but within stale TTL): Return from cache and update in background (or use as offline fallback for cache-first and network-first)
- **Too stale** (past stale TTL): Must fetch from network, not returned from cache

**Example:**

```javascript
fetch("/api/users", {
  headers: {
    "X-SW-Cache-Strategy": "stale-while-revalidate",
    "X-SW-Cache-TTL-Seconds": "300", // Fresh for 5 minutes
    "X-SW-Cache-Stale-TTL-Seconds": "3600" // Usable for 1 hour total
  }
});
```

**Timeline:**

- 0-300s: Return from cache (fresh) - no background update
- 300-3600s: Return from cache (stale) - update in background
- 3600s+: Cache too stale - fetch from network

### `X-SW-Cache-Invalidate`

Explicitly invalidate specific cache entries. Can be set multiple times for multiple paths.

**Important:** When `X-SW-Cache-Invalidate` headers are present, they **take precedence** over automatically inferred invalidation paths. If headers are provided, only the header-specified paths are invalidated - inferred paths are not added. This allows you to have fine-grained control over invalidation even when `inferInvalidation: true`.

**Query Parameter Handling:** Invalidating a path (e.g., `/api/users`) will invalidate all cache entries with that pathname, regardless of query parameters. For example, invalidating `/api/users` will also invalidate `/api/users?org_id=123`, `/api/users?status=active`, and any other query parameter variants.

**Example:**

```javascript
const headers = new Headers();
headers.append("X-SW-Cache-Invalidate", "/api/users");
headers.append("X-SW-Cache-Invalidate", "/api/users/123");
headers.append("X-SW-Cache-Invalidate", "/api/teams");

fetch("/api/users/123", {
  method: "PATCH",
  headers,
  body: JSON.stringify(userData)
});
```

**Example: Headers override inferred paths**

```javascript
// PATCH /api/users/123 with inferInvalidation: true
// Without header, would invalidate: /api/users/123 AND /api/users
// With header, only invalidates: /api/users (header takes precedence)

fetch("/api/users/123", {
  method: "PATCH",
  headers: {
    "X-SW-Cache-Invalidate": "/api/users" // Only this path is invalidated
  },
  body: JSON.stringify(userData)
});
```

### `X-SW-Cache-Clear`

Clear the entire cache. Typically used on logout to remove all user-specific cached data.

**Important:** If this header is present (regardless of its value), the cache will be cleared.

**Important behavior:**

- When this header is present, the handler **always goes to network** - it does not check cache or return cached values
- Stale responses are **never used**, even if offline
- If the network request fails (e.g., offline), the error **bubbles up** to the caller
- The cache is **always cleared** before making the network request, regardless of whether the network request succeeds or fails

**Example:**

```javascript
fetch("/api/logout", {
  method: "POST",
  headers: {
    "X-SW-Cache-Clear": "true" // Any value works - header presence triggers cache clear
  }
});
```

**Note:** While this header is typically used on mutation requests (POST/PATCH/PUT/DELETE), if used on a GET request, it will still clear the cache and attempt to fetch from network. If the network fails, the error will propagate to the caller.

## Header Constants

For convenience, swimple exports header name constants that you can use in your non-service-worker code (e.g., client-side JavaScript) to avoid hard-coding header names. This helps prevent typos and makes refactoring easier.

### Importing Header Constants

#### Node.js / npm Import

```javascript
import {
  CACHE_STRATEGY_HEADER,
  CACHE_TTL_HEADER,
  CACHE_STALE_TTL_HEADER,
  CACHE_INVALIDATE_HEADER,
  CACHE_CLEAR_HEADER
} from "swimple/headers";

// Use in your fetch calls
fetch("/api/users", {
  headers: {
    [CACHE_STRATEGY_HEADER]: "network-first",
    [CACHE_TTL_HEADER]: "600"
  }
});
```

#### CDN Import

```javascript
import {
  CACHE_STRATEGY_HEADER,
  CACHE_TTL_HEADER,
  CACHE_STALE_TTL_HEADER,
  CACHE_INVALIDATE_HEADER,
  CACHE_CLEAR_HEADER
} from "https://cdn.jsdelivr.net/npm/swimple@1.0.0/headers.js";

// Use in your fetch calls
const headers = new Headers();
headers.set(CACHE_TTL_HEADER, "300");
headers.append(CACHE_INVALIDATE_HEADER, "/api/users");
headers.append(CACHE_INVALIDATE_HEADER, "/api/posts");

fetch("/api/users/123", {
  method: "PATCH",
  headers
});
```

### Available Constants

- `CACHE_STRATEGY_HEADER` - `"X-SW-Cache-Strategy"`
- `CACHE_TTL_HEADER` - `"X-SW-Cache-TTL-Seconds"`
- `CACHE_STALE_TTL_HEADER` - `"X-SW-Cache-Stale-TTL-Seconds"`
- `CACHE_INVALIDATE_HEADER` - `"X-SW-Cache-Invalidate"`
- `CACHE_CLEAR_HEADER` - `"X-SW-Cache-Clear"`

**Note:** There is also an internal `CACHE_TIMESTAMP_HEADER` constant (`"x-sw-cache-timestamp"`), but this is used internally by the library and should not be set manually.

## Caching Behavior

### Automatic Caching (Default)

Since `defaultTTLSeconds` defaults to `300`, caching is automatic by default. All GET requests matching the configured scope are cached automatically.

```javascript
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"]
  // defaultTTLSeconds defaults to 300, so all /api/* GETs cached automatically
});

// Automatically cached with default TTL of 300 seconds
fetch("/api/users");

// Completely opt out of caching for specific requests (handler returns null)
fetch("/api/random", {
  headers: {
    "X-SW-Cache-TTL-Seconds": "0"
  }
});
```

### Disabling Automatic Caching

To disable automatic caching, set `defaultTTLSeconds` to `0` or `undefined`. Individual requests can still enable caching with the `X-SW-Cache-TTL-Seconds` header.

```javascript
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  defaultTTLSeconds: 0 // Disable automatic caching
});

// Must explicitly enable caching per request
fetch("/api/users", {
  headers: {
    "X-SW-Cache-TTL-Seconds": "300"
  }
});
```

## Automatic Cache Invalidation

When `inferInvalidation: true` (default), the library automatically invalidates relevant cache entries on mutation requests:

| Request                 | Invalidates                               |
| ----------------------- | ----------------------------------------- |
| `POST /api/users`       | `GET /api/users`                          |
| `PATCH /api/users/123`  | `GET /api/users/123` AND `GET /api/users` |
| `PUT /api/users/123`    | `GET /api/users/123` AND `GET /api/users` |
| `DELETE /api/users/123` | `GET /api/users/123` AND `GET /api/users` |

The library strips the last path segment to find the collection endpoint. This works for most REST API patterns, but may not handle all edge cases (e.g., nested resources like `/api/users/123/avatar`). For edge cases, you can manually specify invalidation paths using the `X-SW-Cache-Invalidate` header.

**Query Parameter Handling:** Cache invalidation matches entries by pathname (ignoring query parameters). This means when you invalidate a path, all cache entries with that pathname are invalidated, regardless of their query parameters. For example, invalidating `/api/users` will also invalidate `/api/users?org_id=123`, `/api/users?status=active`, and any other query parameter variants. This ensures that when you update a resource (e.g., `PATCH /api/users/456`), all filtered views of the collection (e.g., `/api/users?org_id=123`) are also invalidated.

**Note:** If you provide `X-SW-Cache-Invalidate` headers, they take precedence over inferred paths. Only the header-specified paths will be invalidated, not the inferred ones.

**Example: Handling nested resources**

```javascript
// DELETE /api/users/123/avatar - inferred invalidation would only handle
// /api/users/123/avatar and /api/users/123, but we also want to invalidate
// /api/users since the user list might show avatar thumbnails
const headers = new Headers();
headers.append("X-SW-Cache-Invalidate", "/api/users/123/avatar");
headers.append("X-SW-Cache-Invalidate", "/api/users/123");
headers.append("X-SW-Cache-Invalidate", "/api/users");

fetch("/api/users/123/avatar", {
  method: "DELETE",
  headers
});
```

**Example: Query parameter invalidation**

```javascript
// Cache multiple filtered views of the users list
fetch("/api/users"); // Cached
fetch("/api/users?org_id=123"); // Cached separately
fetch("/api/users?org_id=456&status=active"); // Cached separately

// PATCH /api/users/789 - automatically invalidates:
// - /api/users/789 (exact item path)
// - /api/users (collection, no query params)
// - /api/users?org_id=123 (collection with query params)
// - /api/users?org_id=456&status=active (collection with different query params)
// All cache entries with pathname /api/users are invalidated
fetch("/api/users/789", {
  method: "PATCH",
  body: JSON.stringify({ name: "Updated User" })
});
```

You can disable automatic invalidation:

```javascript
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  inferInvalidation: false // Disable automatic invalidation
});
```

## More Usage Examples

### Example 1: Basic API Caching

```javascript
// sw.js
import { createHandleRequest } from "swimple";

const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"]
});

self.addEventListener("fetch", (event) => {
  const response = handleRequest(event);
  if (response) {
    event.respondWith(response);
  }
});

// Client code
// Cache user list for 10 minutes
fetch("/api/users", {
  headers: {
    "X-SW-Cache-TTL-Seconds": "600"
  }
});

// Update user - automatically invalidates /api/users and /api/users/123
fetch("/api/users/123", {
  method: "PATCH",
  body: JSON.stringify({ name: "Jane Doe" })
});
```

### Example 2: Automatic Caching with Custom TTL

```javascript
// sw.js
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  defaultStrategy: "cache-first",
  defaultTTLSeconds: 600 // Cache all API calls for 10 minutes
});

self.addEventListener("fetch", (event) => {
  const response = handleRequest(event);
  if (response) {
    event.respondWith(response);
  }
});

// Client code
// Automatically cached
fetch("/api/users");

// Completely opt out of caching for specific request (handler returns null)
fetch("/api/live-data", {
  headers: {
    "X-SW-Cache-TTL-Seconds": "0"
  }
});
```

### Example 3: Stale-While-Revalidate

```javascript
// sw.js
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  defaultStrategy: "stale-while-revalidate",
  defaultTTLSeconds: 300, // Fresh for 5 minutes - return from cache without background update
  defaultStaleTTLSeconds: 3600 // Stale for up to 1 hour - return from cache and update in background
});

self.addEventListener("fetch", (event) => {
  const response = handleRequest(event);
  if (response) {
    event.respondWith(response);
  }
});

// Client code
// Returns cached data immediately (fresh = no update, stale = update in background)
fetch("/api/users");
```

### Example 4: Multiple Scopes

```javascript
// sw.js
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/", "/graphql/", "/data/"],
  defaultTTLSeconds: 300
});

self.addEventListener("fetch", (event) => {
  const response = handleRequest(event);
  if (response) {
    event.respondWith(response);
  }
});
```

### Example 5: Logout with Cache Clear

```javascript
// Client code
async function logout() {
  await fetch("/api/logout", {
    method: "POST",
    headers: {
      "X-SW-Cache-Clear": "true" // Clear all cached user data
    }
  });

  window.location.href = "/login";
}
```

### Example 6: Custom Request Handler Chain

Your service worker might have other "handlers" or "middlewares" that need to be called before the cache handler.

```javascript
// sw.js
import { createHandleRequest } from "swimple";

const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  scope: ["/api/"],
  defaultTTLSeconds: 300
});

// Custom handler for special handling
const customHandler = (event) => {
  const url = new URL(event.request.url);

  // Special handling for auth endpoints
  if (url.pathname.startsWith("/api/auth")) {
    return fetch(event.request);
  }

  return null; // Fall through
};

self.addEventListener("fetch", (event) => {
  // Try custom handler first
  let response = customHandler(event);
  if (response) {
    event.respondWith(response);
    return;
  }

  // Then try cache handler
  response = handleRequest(event);
  if (response) {
    event.respondWith(response);
    return;
  }

  // Default fetch
  event.respondWith(fetch(event.request));
});
```

## How It Works

1. **GET Requests**: The request handler checks if a GET request matches the configured scope and caching criteria
2. **Cache Lookup**: For eligible requests, it checks the Cache API for a valid cached response
3. **Strategy Execution**: Based on the strategy (cache-first, network-first, stale-while-revalidate), it either returns cached data or fetches from network
4. **TTL Management**: Cached responses store only the timestamp of when they were cached. When a request is made, the TTL from the request (or default) is used to calculate if the cached response is fresh or stale by comparing the current time with the cached timestamp. Responses within the TTL are "fresh" (returned without background updates). Responses past the TTL but within the stale TTL are "stale" (returned with background updates or used as offline fallback)
5. **Mutation Handling**: POST/PATCH/PUT/DELETE requests trigger cache invalidation based on inferred or explicit paths
6. **Cache Clearing**: Requests with `X-SW-Cache-Clear` header wipe the entire cache

## Important Notes

- Only GET requests are cached
- Only 2xx (OK) GET responses are cached. Non-OK responses (4xx, 5xx, etc.) are not cached
- **Cross-origin requests are not cached** - Only requests to the same origin as the service worker are cached. Requests to different origins will return `null` and are not processed by the cache handler.
- Non-GET and non-mutating requests (POST/PATCH/PUT/DELETE) are not processed by the cache handler - it will return null. Practically, this means HEAD requests are not handled by the cache handler.
- Query strings are part of the cache key. Different query strings create different cache entries (e.g., `/api/users?page=1` and `/api/users?page=2` are separate cache entries). However, cache invalidation matches by pathname (ignoring query parameters), so invalidating `/api/users` will invalidate all query variants like `/api/users?page=1`, `/api/users?org_id=123`, etc.
- Cache invalidation happens automatically for mutations when `inferInvalidation: true`
- All headers are case-insensitive (per HTTP spec)
- TTL of `0` completely opts out of caching for a request - the handler returns `null` immediately without checking cache, making network requests, or processing the request.
- Cache entries store only the timestamp of when they were cached. The TTL is not stored; it's provided by each request (or set with a default via `createHandleRequest` config) and the freshness or staleness is calculated at request time. This means one request could use a longer TTL than another request and therefore allow a later expiration time.

## Error Handling

The library follows a straightforward error handling approach:

### Configuration Validation Errors

Invalid configuration values passed to `createHandleRequest` will throw errors immediately. This helps catch configuration mistakes early.

```javascript
// This will throw an error
const handleRequest = createHandleRequest({
  cacheName: "api-cache-v1",
  defaultStrategy: "invalid-strategy" // Error: invalid strategy
});
```

### Exceptional Errors

The library does not catch or swallow exceptional errors. If an internal operation like `cache.delete()` throws an exception (which is truly exceptional since browsers don't throw in normal cases), that error will bubble up to your code.

This means you can wrap your `handleRequest` calls in try/catch if you want to handle errors:

```javascript
self.addEventListener("fetch", (event) => {
  try {
    const response = handleRequest(event);
    if (response) {
      event.respondWith(response);
    }
  } catch (error) {
    // Handle exceptional errors
    console.error("Cache handler error:", error);
    // Fall back to network
    event.respondWith(fetch(event.request));
  }
});
```

If you don't wrap `handleRequest` in try/catch, any exceptional errors will propagate normally, which may cause the service worker fetch handler to fail. Whether you need error handling depends on your application's requirements.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR on GitHub.

## Links

- [GitHub Repository](https://github.com/wes-goulet/swimple)
- [NPM Package](https://www.npmjs.org/package/swimple)
- [Report Issues](https://github.com/wes-goulet/swimple/issues)
