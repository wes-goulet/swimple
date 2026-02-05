# Technical Decisions

This document outlines the technical decisions and constraints for the swimple library.

## Project Structure

- **Node.js project** with `package.json` for metadata and scripts
- **No dependencies** - the library is self-contained with zero runtime dependencies
- **No bundlers** - the library is distributed as-is, using ES modules directly
- **Simple and lean** - no complex build steps, no complex tooling, no complex dependencies

## Code Style

- **JavaScript files** (`.js`) - no TypeScript compilation step
- **Type checking via JSDoc** - use JSDoc comments for type information
- **`@ts-check` directive** - add `// @ts-check` at the top of each `.js` file for type checking
- **Prettier** - use Prettier for consistent code formatting
- **Pure functions preferred** - prefer pure functions when possible, hoist them to module level
- **Document time units** - always clarify units of time in JSDoc comments (seconds, milliseconds, etc.)

## Code Organization

- **ES Modules** - use `import`/`export` syntax (no CommonJS)
- **Single entry point** - `index.js` exports the main `createHandleRequest` function
- **Service Worker compatible** - code must work in service worker context (no Node.js APIs)

## Implementation Details

### Cache Storage

- Use browser Cache API (`caches.open(cacheName)`)
- Store timestamp as custom header `x-sw-cache-timestamp` in cached Response
- Only cache 2xx (OK) GET responses

### Cache Key Format

- Query strings are part of cache key (different query = different cache entry)
- Cache entries matched by exact URL (including query string)

### Network Detection

- Do not use `navigator.onLine` - unreliable
- Attempt fetch and catch errors - if fetch throws, treat as offline
- Fall back to stale cache when network request fails

### Response Handling

- Clone responses when used multiple times (e.g., stale-while-revalidate)
- Store only timestamp with cached response, not TTL
- Calculate freshness/staleness at request time using request's TTL

### Scope Matching

- Prefix-based matching (URL starts with scope string)
- Case-sensitive URL matching

### Header Parsing

- Headers are case-insensitive (per HTTP spec)
- Use `Headers.getAll()` or similar for multiple values
- Use `Headers.append()` for multiple invalidation headers (not comma-separated)

### Invalidation

- Delete cache entries by exact URL match
- Inferred invalidation: exact path + parent collection (strip last path segment)
- Manual invalidation via `X-SW-Cache-Invalidate` header (can be set multiple times)

### Error Handling

- **Config validation** - Invalid config values passed to `createHandleRequest` will throw errors
- Validate required fields (e.g., `cacheName` must be provided)
- Validate config option types and values (e.g., `defaultStrategy` must be one of the allowed values)
- Throw descriptive error messages to help users debug configuration issues

## Testing

- **Node test runner** - use Node's built-in test runner for unit tests (`.unit.test.js` files)
- **Playwright** - use Playwright for UI/E2E tests (`.ui.test.js` files)
- **Chromium only** - service worker testing in Playwright is limited to Chromium-based browsers
- **File naming convention** - test files follow the pattern `{sourcefile}.{type}.test.js`:
  - `{sourcefile}.unit.test.js` - unit tests for pure functions from the source file (uses Node test runner)
  - `{sourcefile}.ui.test.js` - UI/E2E tests (e.g., service worker registration, cache behavior, invalidation, caching strategies) - uses Playwright
- **Browser APIs in Node** - Node 18+ includes `fetch`, `Headers`, and `Response` APIs, so no polyfills needed for unit tests
- Test service worker registration, cache behavior, invalidation, and all caching strategies
- Use `browserContext.serviceWorkers()` and `context.waitForEvent('serviceworker')` to interact with service workers

## Type Declarations

- **JSDoc-based type generation** - TypeScript declaration files (`.d.ts`) are generated from JSDoc comments in source files
- **No tsconfig.json** - TypeScript compiler is invoked via command-line arguments in `prepublishOnly` script
- **Generated files not checked in** - Generated `.d.ts` files (e.g., `index.d.ts`, `headers.d.ts`, `helpers.d.ts`) are excluded from git via `.gitignore`
- **Manual type definitions** - `types.d.ts` contains manually-written type definitions and is checked into git
- **Pre-publish generation** - Declaration files are generated automatically during `prepublishOnly` hook before npm publish
- **Export map includes types** - Package `exports` field includes `types` property pointing to generated `.d.ts` files for TypeScript users

## Distribution

- **CDN distribution** - via jsDelivr (e.g., `https://cdn.jsdelivr.net/npm/swimple@1.0.6/index.js`)
- **NPM package** - publish to npm for `npm install swimple`
- **ES Module only** - no CommonJS build, no UMD build

## Browser Support

- Modern browsers with ES module service worker support
- All modern browsers as of January 2026 support module service workers
