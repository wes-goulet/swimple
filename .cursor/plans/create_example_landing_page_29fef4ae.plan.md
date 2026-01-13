---
name: Create Example Landing Page
overview: Create an example landing/marketing page that demonstrates swimple with default configuration, including an index.html and sw.js service worker file in a new example folder.
todos:
  - id: create-example-folder
    content: Create example folder structure
    status: completed
  - id: create-sw-js
    content: "Create sw.js service worker with swimple default configuration (cacheName: sw-cache-v1, scope: /api/) and mock API handlers using IndexedDB for mutations"
    status: completed
  - id: create-index-html
    content: Create index.html landing page with hero, features, demo section, and code examples
    status: completed
  - id: add-demo-functionality
    content: Add interactive demo with API requests, cache indicators, and mutation examples that use IndexedDB
    status: completed
  - id: add-cache-inspector
    content: Add visual cache inspector section that displays current cache entries, updates on cache changes, and shows cache entry details (URL, timestamp, age)
    status: completed
---

# Create Example Landing Page for swimple

Create a simple, clean landing/marketing page similar to [side-drawer.goulet.dev](https://side-drawer.goulet.dev/) that demonstrates swimple in action.

## Files to Create

### `example/index.html`

- Clean, modern landing page showcasing swimple
- Register the service worker (`/example/sw.js`)
- Include a working demo that makes API requests to demonstrate caching
- Show key features: automatic caching, cache invalidation, offline support
- **Cache Inspector section**: Visual display of current cache entries showing:
- List of cached URLs
- Cache entry timestamps and age
- Real-time updates when entries are added/removed
- Makes cache behavior visually obvious without dev tools
- Link to GitHub repository for full documentation
- Use inline CSS for simplicity (no external dependencies)
- Include a simple API endpoint mock/demo that shows cache behavior

### `example/sw.js`

- Service worker using swimple with default configuration
- Import from CDN: `https://cdn.jsdelivr.net/npm/swimple@0.12.1/index.js`
- Import `customFetch` from `./mock-api.js` for mock API responses
- Configuration:
- `cacheName: "sw-cache-v1"`
- `scope: ["/api/"]` (for realistic example)
- All other settings use defaults (cache-first strategy, 300s TTL, etc.)
- Standard fetch event listener pattern that delegates to swimple handler

### `example/mock-api.js`

- **Mock API handlers** (demo-only, clearly commented):
- Contains all mock API endpoint handlers for demonstration purposes only
- Clear comments indicating these are demo-only and not part of real implementations
- Mock GET endpoints return JSON responses (these will be cached by swimple)
- Mock mutation endpoints (POST/PATCH/PUT/DELETE) store data in IndexedDB
- Mutations do NOT store responses in cache - only IndexedDB
- Exports `customFetch` function that intercepts `/api/*` requests and returns mock responses
- This ensures the cache only contains responses handled by swimple, not mock data
- Separated into its own file for better code organization

## Implementation Details

1. **Landing Page Structure**:

- Hero section with library name and tagline
- Features list (automatic caching, smart invalidation, lightweight, etc.)
- Live demo section showing cache behavior
- **Cache Inspector section**: Visual display of cache entries that updates in real-time
- Code examples showing basic usage
- Links to GitHub and npm

2. **Demo Functionality**:

- Mock API endpoint (can use a simple JSON response or a service like JSONPlaceholder)
- Buttons to trigger GET requests (show cache hits)
- Button to trigger mutation (POST/PATCH) to show cache invalidation
- Visual indicators showing when responses come from cache vs network
- Optionally show offline simulation

3. **Styling**:

- Clean, modern design
- Responsive layout
- Simple color scheme
- No external CSS frameworks (keep it lightweight like the library)

4. **Service Worker**:

- Use ES module syntax (`type: "module"`)
- Import from jsDelivr CDN
- Import `customFetch` from `./mock-api.js` module
- **Mock API handlers** (in `mock-api.js`, demo-only, clearly commented):
- Intercept `/api/*` requests via `customFetch` function
- GET requests: Return mock JSON data (will be cached by swimple)
- Mutations: Read/write to IndexedDB, return success responses
- Mutations do NOT cache responses - only IndexedDB storage
- Handle fetch events: Pass all `/api/*` requests to swimple handler, which uses `customFetch` for network requests
- This architecture ensures:
- Cache only contains responses handled by swimple caching library
- Mock data mutations stored separately in IndexedDB
- Clear separation between demo mocks and actual caching behavior
- Better code organization with mock API code in separate file

5. **Cache Inspector Implementation**:

- JavaScript function to read from Cache API: `caches.open("sw-cache-v1").then(cache => cache.keys())`
- Extract cache timestamp from response headers (`x-sw-cache-timestamp`)
- Calculate age: `Date.now() - timestamp`
- Display entries in a table or list format showing:
- URL
- Cached timestamp (formatted date/time)
- Age (e.g., "2 minutes ago", "5 seconds ago")
- Refresh cache display:
- After each API request completes
- On manual refresh button click
- Visual feedback: