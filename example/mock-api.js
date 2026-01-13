// @ts-check
// ============================================================================
// DEMO-ONLY MOCK API HANDLERS
// ============================================================================
// These mock API handlers are for demonstration purposes only.
// In a real implementation, you would make actual API calls to your backend.
// These handlers intercept /api/* requests and provide mock responses.
// GET requests return JSON that will be cached by swimple.
// Mutations (POST/PATCH/PUT/DELETE) store data in IndexedDB (not cache).
// ============================================================================
//
// Available API Endpoints:
//
// GET /api/users
//   Returns: Array of user objects
//
// GET /api/users/:id
//   Returns: Single user object or 404
//
// GET /api/posts
//   Returns: Array of post objects
//
// POST /api/users
//   Body: { name: string, email: string }
//   Returns: Created user object (201)
//
// PATCH /api/users/:id
//   Body: Partial user object
//   Returns: Updated user object or 404
//
// DELETE /api/users/:id
//   Returns: { success: true }
//
// ============================================================================

/// <reference lib="webworker" />

const DB_NAME = "swimple-demo-db";
const DB_VERSION = 1;
const STORE_NAME = "api-data";

/**
 * Initialize IndexedDB for storing mock API data
 * @returns {Promise<IDBDatabase>}
 */
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = /** @type {IDBDatabase} */ (
        /** @type {any} */ (event?.target)?.result
      );
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

/**
 * Get data from IndexedDB
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getFromDB(key) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.data || null);
  });
}

/**
 * Save data to IndexedDB
 * @param {string} key
 * @param {any} data
 * @returns {Promise<void>}
 */
async function saveToDB(key, data) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id: key, data });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Handle mock API GET requests
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
async function handleMockGet(url) {
  // Mock /api/users endpoint
  if (url.pathname === "/api/users") {
    const users = (await getFromDB("users")) || [
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
      { id: 3, name: "Charlie", email: "charlie@example.com" }
    ];

    return new Response(JSON.stringify(users), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Mock /api/users/:id endpoint
  const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) {
    const userId = userMatch[1];
    const users = (await getFromDB("users")) || [
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
      { id: 3, name: "Charlie", email: "charlie@example.com" }
    ];
    const user = users.find((u) => u.id === parseInt(userId, 10));

    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify(user), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Mock /api/posts endpoint
  if (url.pathname === "/api/posts") {
    const posts = (await getFromDB("posts")) || [
      {
        id: 1,
        title: "Getting Started with swimple",
        author: "Alice",
        content: "swimple makes service worker caching simple!"
      },
      {
        id: 2,
        title: "Cache Strategies Explained",
        author: "Bob",
        content:
          "Learn about cache-first, network-first, and stale-while-revalidate."
      }
    ];

    return new Response(JSON.stringify(posts), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return null;
}

/**
 * Handle mock API mutation requests (POST/PATCH/PUT/DELETE)
 * These store data in IndexedDB and return success responses.
 * NOTE: These responses are NOT cached - only IndexedDB is used for storage.
 * @param {Request} request
 * @returns {Promise<Response | null>}
 */
async function handleMockMutation(request) {
  const url = new URL(request.url);
  const method = request.method;

  // Handle POST /api/users (create user)
  if (method === "POST" && url.pathname === "/api/users") {
    const body = await request.json();
    const users = (await getFromDB("users")) || [
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
      { id: 3, name: "Charlie", email: "charlie@example.com" }
    ];

    const newUser = {
      id: Math.max(...users.map((u) => u.id)) + 1,
      ...body
    };
    users.push(newUser);
    await saveToDB("users", users);

    return new Response(JSON.stringify(newUser), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Handle PATCH /api/users/:id (update user)
  const userPatchMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (method === "PATCH" && userPatchMatch) {
    const userId = parseInt(userPatchMatch[1], 10);
    const body = await request.json();
    const users = (await getFromDB("users")) || [
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
      { id: 3, name: "Charlie", email: "charlie@example.com" }
    ];

    const userIndex = users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    users[userIndex] = { ...users[userIndex], ...body };
    await saveToDB("users", users);

    return new Response(JSON.stringify(users[userIndex]), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Handle DELETE /api/users/:id (delete user)
  const userDeleteMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (method === "DELETE" && userDeleteMatch) {
    const userId = parseInt(userDeleteMatch[1], 10);
    const users = (await getFromDB("users")) || [
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
      { id: 3, name: "Charlie", email: "charlie@example.com" }
    ];

    const filteredUsers = users.filter((u) => u.id !== userId);
    await saveToDB("users", filteredUsers);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return null;
}

/**
 * Custom fetch function that returns mock API responses
 * This function intercepts /api/* requests and returns mock responses.
 * swimple will use this function when making network requests, so mock responses
 * will be properly cached by swimple.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function customFetch(request) {
  const url = new URL(request.url);

  // Only intercept /api/* requests
  if (!url.pathname.startsWith("/api/")) {
    return fetch(request); // Use normal fetch for non-API requests
  }

  // Handle mock mutations (POST/PATCH/PUT/DELETE)
  // These store data in IndexedDB and return success responses
  // NOTE: These responses are NOT cached by swimple (only 2xx GET responses are cached)
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    const mockResponse = await handleMockMutation(request);
    if (mockResponse) {
      return mockResponse;
    }
  }

  // Handle mock GET requests
  // These return JSON responses that will be cached by swimple
  if (request.method === "GET") {
    const mockResponse = await handleMockGet(url);
    if (mockResponse) {
      return mockResponse;
    }
  }

  // Fallback to normal fetch for any other requests
  return fetch(request);
}
