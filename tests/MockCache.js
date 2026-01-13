// @ts-check

/**
 * Mock Cache API implementation for Node.js unit tests
 * Provides a simple in-memory implementation of the browser Cache API
 */
export class MockCacheStorage {
  /** @type {Map<string, Cache>} */
  _caches = new Map();

  /**
   * Opens a cache by name
   * @param {string} name
   * @returns {Promise<Cache | undefined>}
   */
  async open(name) {
    if (!this._caches.has(name)) {
      const cache = {
        /** @type {Map<string, Response>} */
        _entries: new Map(),
        /**
         * @param {Request | string} request
         * @returns {Promise<Response | undefined>}
         */
        async match(request) {
          const url = typeof request === "string" ? request : request.url;
          const response = this._entries.get(url);
          // Browser Cache API returns cloned responses, so we match that behavior
          return response ? response.clone() : undefined;
        },
        /**
         * @param {Request | string} request
         * @param {{ ignoreSearch?: boolean }} options
         * @returns {Promise<Response[]>}
         */
        async matchAll(request, options = {}) {
          const requestUrl =
            typeof request === "string" ? request : request.url;
          const ignoreSearch = options.ignoreSearch === true;
          const matchingResponses = [];

          try {
            const requestUrlObj = new URL(requestUrl);
            const requestPathname = requestUrlObj.pathname;

            for (const [cachedUrl, response] of this._entries.entries()) {
              try {
                const cachedUrlObj = new URL(cachedUrl);
                const cachedPathname = cachedUrlObj.pathname;

                if (ignoreSearch) {
                  // Match by pathname only (ignore query parameters)
                  if (cachedPathname === requestPathname) {
                    const clonedResponse = response.clone();
                    matchingResponses.push(clonedResponse);
                  }
                } else {
                  // Exact match (including query parameters)
                  if (cachedUrl === requestUrl) {
                    const clonedResponse = response.clone();
                    matchingResponses.push(clonedResponse);
                  }
                }
              } catch {
                // Invalid URL, skip
              }
            }
          } catch {
            // If request URL is invalid, try exact match
            const response = this._entries.get(requestUrl);
            if (response) {
              const clonedResponse = response.clone();
              matchingResponses.push(clonedResponse);
            }
          }

          return matchingResponses;
        },
        /**
         * @param {Request | string} request
         * @param {Response} response
         * @returns {Promise<void>}
         */
        async put(request, response) {
          const url = typeof request === "string" ? request : request.url;
          this._entries.set(url, response);
        },
        /**
         * @param {Request | string} request
         * @param {{ ignoreSearch?: boolean }} options
         * @returns {Promise<boolean>}
         */
        async delete(request, options = {}) {
          const url = typeof request === "string" ? request : request.url;
          const ignoreSearch = options.ignoreSearch === true;

          // Try exact match first (unless ignoreSearch is true)
          if (!ignoreSearch && this._entries.has(url)) {
            return this._entries.delete(url);
          }

          // If ignoreSearch is true, delete all entries matching pathname
          if (ignoreSearch) {
            try {
              const requestUrlObj = new URL(url);
              const requestPathname = requestUrlObj.pathname;
              let deleted = false;

              for (const [cachedUrl] of this._entries.entries()) {
                try {
                  const cachedUrlObj = new URL(cachedUrl);
                  if (cachedUrlObj.pathname === requestPathname) {
                    this._entries.delete(cachedUrl);
                    deleted = true;
                  }
                } catch {
                  // Invalid URL, skip
                }
              }
              return deleted;
            } catch {
              // Invalid URL, fall through to other matching logic
            }
          }

          // If it's a path (starts with /), try to match against pathname of cached URLs
          if (url.startsWith("/")) {
            let deleted = false;
            for (const [cachedUrl] of this._entries.entries()) {
              try {
                const cachedUrlObj = new URL(cachedUrl);
                if (cachedUrlObj.pathname === url) {
                  this._entries.delete(cachedUrl);
                  deleted = true;
                }
              } catch {
                // Invalid URL, skip
              }
            }
            return deleted;
          }

          return false;
        },
        /**
         * @returns {Promise<Request[]>}
         */
        async keys() {
          return Array.from(this._entries.keys()).map(
            (url) => new Request(url)
          );
        }
      };
      this._caches.set(
        name,
        /** @type {Cache} */ (/** @type {unknown} */ (cache))
      );
    }
    return this._caches.get(name);
  }

  /**
   * Deletes a cache by name
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async delete(name) {
    return this._caches.delete(name);
  }
}
