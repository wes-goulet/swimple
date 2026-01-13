---
name: Cache cleanup implementation
overview: Implement reactive and periodic cache cleanup with a configurable `maxCacheAgeSeconds` option that defaults to 7200 seconds (2x default stale TTL).
todos:
  - id: add-config-option
    content: Add maxCacheAgeSeconds to HandleRequestConfig type and createHandleRequest config handling
    status: pending
  - id: create-cleanup-functions
    content: Create cleanupOldCacheEntries function in helpers.js to delete entries older than maxAgeSeconds
    status: pending
  - id: implement-reactive-cleanup
    content: Add reactive cleanup in index.js - delete entries when accessed and found older than maxCacheAgeSeconds
    status: pending
    dependencies:
      - create-cleanup-functions
  - id: implement-periodic-cleanup
    content: Add periodic cleanup logic that runs every 100 fetches (using closure counter)
    status: pending
    dependencies:
      - create-cleanup-functions
  - id: export-cleanup-function
    content: Export cleanupOldCacheEntries from helpers.js for manual cleanup
    status: pending
    dependencies:
      - create-cleanup-functions
  - id: update-documentation
    content: Update README.md with maxCacheAgeSeconds config option and cleanup behavior documentation
    status: pending
    dependencies:
      - add-config-option
---

# Cache Cleanup Implementation

Implement automatic cache cleanup to prevent unbounded cache growth by removing entries that are too old to be useful.

## Implementation Details

### 1. Add `maxCacheAgeSeconds` Configuration Option

- Add `maxCacheAgeSeconds` to `HandleRequestConfig` in [types.d.ts](types.d.ts) (optional, defaults to 7200)
- Update `createHandleRequest` in [index.js](index.js) to accept and store this config value
- Update `validateConfig` in [helpers.js](helpers.js) to validate the new option (must be a positive number)

### 2. Create Cleanup Functions

Add to [helpers.js](helpers.js):

- `isOlderThanMaxAge(response, maxAgeSeconds)` - Checks if a cached response is older than `maxAgeSeconds`
- `cleanupOldCacheEntries(cacheName, maxAgeSeconds)` - Deletes all cache entries older than `maxAgeSeconds`

### 3. Implement Reactive Cleanup

Update cache access points in [index.js](index.js):

- When accessing a cached entry, check if it's older than `maxCacheAgeSeconds` (not stale TTL)
- If the entry age exceeds `maxCacheAgeSeconds`, delete it immediately
- This happens in all three strategy handlers (cache-first, network-first, stale-while-revalidate)
- Create a helper function `isOlderThanMaxAge(response, maxAgeSeconds)` in [helpers.js](helpers.js) to check entry age

### 4. Implement Periodic Cleanup

Add periodic cleanup to [index.js](index.js):

- Track fetch counter (stored in a closure variable, initialized to 0)
- Increment counter on each fetch
- Run cleanup when counter === 0 (first fetch) OR when counter % 100 === 0 (every 100 fetches)
- After cleanup, reset counter to 1 (not 0) so next cleanup happens 100 fetches later
- Cleanup runs asynchronously in the background and doesn't block fetch responses
- **Note**: Service workers can be terminated by the browser at any time, which resets closure variables. When the service worker restarts, the counter resets to 0, ensuring cleanup runs on the first fetch after restart. This ensures cleanup happens even if the service worker restarts frequently before reaching 100 fetches.

### 5. Export Cleanup Function

- Export `cleanupOldCacheEntries` from [helpers.js](helpers.js) so users can manually trigger cleanup in their service worker `activate` handler if desired

### 6. Update Documentation

Update [README.md](README.md):

- Add `maxCacheAgeSeconds` to the configuration options table
- Document automatic cleanup behavior
- Add example of manual cleanup in service worker activate handler
- Update the TODO item to mark it as complete

## Key Design Decisions