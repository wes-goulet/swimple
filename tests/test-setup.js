// @ts-check
/**
 * Shared test setup for Node.js test environment
 * Mocks browser APIs to match browser behavior
 */

import { MockCacheStorage } from "./MockCache.js";

// Mock Cache API for Node.js environment
// @ts-ignore - Mocking browser API for Node.js tests
globalThis.caches = globalThis.caches || new MockCacheStorage();

// Override Response.prototype.clone to simulate browser behavior where
// cloned response headers are immutable (read-only)
const originalClone = Response.prototype.clone;
Response.prototype.clone = function () {
  const cloned = originalClone.call(this);
  const originalHeaders = cloned.headers;

  // Create a new Headers object with all the original headers
  // This simulates the browser behavior where cloned headers are a separate read-only object
  const immutableHeaders = new Headers();
  for (const [key, value] of originalHeaders.entries()) {
    immutableHeaders.set(key, value);
  }

  // Override mutation methods to throw errors (simulating immutability)
  // But allow all read operations to work normally
  Object.defineProperty(immutableHeaders, 'set', {
    value: function () {
      throw new TypeError("Failed to execute 'set' on 'Headers': Headers are immutable");
    },
    writable: false,
    configurable: false
  });

  Object.defineProperty(immutableHeaders, 'append', {
    value: function () {
      throw new TypeError("Failed to execute 'append' on 'Headers': Headers are immutable");
    },
    writable: false,
    configurable: false
  });

  Object.defineProperty(immutableHeaders, 'delete', {
    value: function () {
      throw new TypeError("Failed to execute 'delete' on 'Headers': Headers are immutable");
    },
    writable: false,
    configurable: false
  });

  // Replace the headers property on the cloned response
  Object.defineProperty(cloned, 'headers', {
    value: immutableHeaders,
    writable: false,
    configurable: false
  });

  return cloned;
};
