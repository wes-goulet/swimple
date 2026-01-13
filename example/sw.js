// @ts-check

/// <reference lib="webworker" />

// @ts-expect-error - we're using a CDN import
import { createHandleRequest } from "https://cdn.jsdelivr.net/npm/swimple@1.0.0/src/index.js";
import { customFetch } from "./mock-api.js";

// make typing easier
const _self = /** @type {ServiceWorkerGlobalScope} */ (
  /** @type {unknown} */ (self)
);

_self.addEventListener("install", () => {
  // NOTE: don't just copy paste this code without understanding it, you might
  // not want to skip waiting for your app
  _self.skipWaiting();
});

_self.addEventListener("activate", (event) => {
  // NOTE: don't just copy paste this code without understanding it, you might
  // not want to call clients.claim() for your app
  event.waitUntil(_self.clients.claim());
});

// Create the swimple request handler with default configuration
// We provide customFetch so that mock API responses are returned when swimple
// makes network requests, and those responses will be cached by swimple.
const handleRequest = createHandleRequest({
  cacheName: "sw-cache-v1",
  scope: ["/api/"], // Only cache requests that start with /api/
  customFetch: customFetch, // Use our custom fetch for mock API responses
  loggingLevel: "verbose" // Log verbose information about what's happening
  // All other settings use defaults:
  // - defaultStrategy: "cache-first"
  // - defaultTTLSeconds: 300 (5 minutes)
  // - defaultStaleTTLSeconds: 3600 (1 hour)
  // - inferInvalidation: true (automatic cache invalidation on mutations)
});

_self.addEventListener("fetch", (event) => {
  // Handle the request with swimple
  // - For GET requests: swimple will check cache, use customFetch for network, and cache responses
  // - For mutations: swimple will invalidate cache and use customFetch to get the response
  // - For any requests outside the scope ("/api/"): swimple will return null and let the browser handle the request normally
  const response = handleRequest(event);
  if (response) {
    event.respondWith(response);
    return;
  }

  // By simply returning, we let the browser handle the request
  return;
});
