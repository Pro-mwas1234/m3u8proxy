// src/lib/getHandler.js — Request router with baseUrl support
// ✅ Now accepts baseUrl in options and passes it to proxy functions

import { isValidHostName } from "./isValidHostName.js";
import { getProxyForUrl } from "proxy-from-env";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "url";
import withCORS from "./withCORS.js";
import parseURL from "./parseURL.js";
import proxyM3U8 from "./proxyM3U8.js";
import { proxyTs } from "./proxyTS.js";

export default function getHandler(options, proxy) {
  const corsAnywhere = {
    handleInitialRequest: null,
    getProxyForUrl: getProxyForUrl,
    maxRedirects: 5,
    originBlacklist: [],
    originWhitelist: [],
    checkRateLimit: null,
    redirectSameOrigin: false,
    requireHeader: null,
    removeHeaders: [],
    setHeaders: {},
    corsMaxAge: 0,
    baseUrl: null, // ✅ Added baseUrl option
  };

  // Merge user options into defaults
  Object.keys(corsAnywhere).forEach(function (option) {
    if (Object.prototype.hasOwnProperty.call(options, option)) {
      corsAnywhere[option] = options[option];
    }
  });

  // Normalize requireHeader to lowercase array
  if (corsAnywhere.requireHeader) {
    if (typeof corsAnywhere.requireHeader === "string") {
      corsAnywhere.requireHeader = [corsAnywhere.requireHeader.toLowerCase()];
    } else if (
      !Array.isArray(corsAnywhere.requireHeader) ||
      corsAnywhere.requireHeader.length === 0
    ) {
      corsAnywhere.requireHeader = null;
    } else {
      corsAnywhere.requireHeader = corsAnywhere.requireHeader.map(function (
        headerName
      ) {
        return headerName.toLowerCase();
      });
    }
  }

  const hasRequiredHeaders = function (headers) {
    return (
      !corsAnywhere.requireHeader ||
      corsAnywhere.requireHeader.some(function (headerName) {
        return Object.hasOwnProperty.call(headers, headerName);
      })
    );
  };

  return function (req, res) {
    req.corsAnywhereRequestState = {
      getProxyForUrl: corsAnywhere.getProxyForUrl,
      maxRedirects: corsAnywhere.maxRedirects,
      corsMaxAge: corsAnywhere.corsMaxAge,
    };

    const cors_headers = withCORS({}, req);
    
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(200, cors_headers);
      res.end();
      return;
    }

    const location = parseURL(req.url.slice(1));

    // Handle initial request hook
    if (
      corsAnywhere.handleInitialRequest &&
      corsAnywhere.handleInitialRequest(req, res, location)
    ) {
      return;
    }

    // Serve index.html if no location parsed
    if (!location) {
      if (/^\/https?:\/[^/]/i.test(req.url)) {
        res.writeHead(400, "Missing slash", cors_headers);
        res.end(
          "The URL is invalid: two slashes are needed after the http(s):."
        );
        return;
      }
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(readFileSync(join(__dirname, "../index.html"), "utf-8"));
      return;
    }

    // Handle iscorsneeded endpoint
    if (location.host === "iscorsneeded") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("no");
      return;
    }

    // Validate port range
    if ((Number(location.port) ?? 0) > 65535) {
      res.writeHead(400, "Invalid port", cors_headers);
      res.end("Port number too large: " + location.port);
      return;
    }

    // ✅ ROUTE PROXY ENDPOINTS — Use baseUrl instead of hardcoded localhost
    if (!/^\/https?:/.test(req.url) && !isValidHostName(location.hostname)) {
      // ✅ Use options.baseUrl or fallback to safe default
      const baseForParse = corsAnywhere.baseUrl || "https://localhost";
      const uri = new URL(req.url ?? "", baseForParse);
      
      if (uri.pathname === "/m3u8-proxy") {
        let headers = {};
        try {
          const headersStr = uri.searchParams.get("headers");
          headers = headersStr ? JSON.parse(decodeURIComponent(headersStr)) : {};
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(e.message);
          return;
        }
        const url = uri.searchParams.get("url");
        // ✅ PASS baseUrl to proxyM3U8
        return proxyM3U8(url ?? "", headers, res, corsAnywhere.baseUrl);
        
      } else if (uri.pathname === "/ts-proxy") {
        let headers = {};
        try {
          const headersStr = uri.searchParams.get("headers");
          headers = headersStr ? JSON.parse(decodeURIComponent(headersStr)) : {};
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(e.message);
          return;
        }
        const url = uri.searchParams.get("url");
        // ✅ PASS baseUrl to proxyTs
        return proxyTs(url ?? "", headers, req, res, corsAnywhere.baseUrl);
        
      } else if (uri.pathname === "/" || uri.pathname === "/index.html") {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(readFileSync(join(__dirname, "../index.html"), "utf-8"));
        return;
      } else {
        res.writeHead(404, "Invalid host", cors_headers);
        res.end("Invalid host: " + location.hostname);
        return;
      }
    }

    // Validate required headers
    if (!hasRequiredHeaders(req.headers)) {
      res.writeHead(400, "Header required", cors_headers);
      res.end(
        "Missing required request header. Must specify one of: " +
          corsAnywhere.requireHeader
      );
      return;
    }

    // Origin blacklist/whitelist checks
    const origin = req.headers.origin || "";
    if (corsAnywhere.originBlacklist.indexOf(origin) >= 0) {
      res.writeHead(403, "Forbidden", cors_headers);
      res.end(
        'The origin "' +
          origin +
          '" was blacklisted by the operator of this proxy.'
      );
      return;
    }

    if (
      corsAnywhere.originWhitelist.length &&
      corsAnywhere.originWhitelist.indexOf(origin) === -1
    ) {
      res.writeHead(403, "Forbidden", cors_headers);
      res.end(
        'The origin "' +
          origin +
          '" was not whitelisted by the operator of this proxy.'
      );
      return;
    }

    // Rate limiting check
    const rateLimitMessage =
      corsAnywhere.checkRateLimit && corsAnywhere.checkRateLimit(origin);
    if (rateLimitMessage) {
      res.writeHead(429, "Too Many Requests", cors_headers);
      res.end(
        'The origin "' +
          origin +
          '" has sent too many requests.\n' +
          rateLimitMessage
      );
      return;
    }

    // Same-origin redirect
    if (
      corsAnywhere.redirectSameOrigin &&
      origin &&
      location.href[origin.length] === "/" &&
      location.href.lastIndexOf(origin, 0) === 0
    ) {
      cors_headers.vary = "origin";
      cors_headers["cache-control"] = "private";
      cors_headers.location = location.href;
      res.writeHead(301, "Please use a direct request", cors_headers);
      res.end();
      return;
    }

    // Determine if request came over HTTPS
    const isRequestedOverHttps =
      req.connection?.encrypted ||
      /^\s*https/.test(req.headers["x-forwarded-proto"]);
      
    // ✅ Use baseUrl if available, otherwise build from request
    const proxyBaseUrl = corsAnywhere.baseUrl || 
      (isRequestedOverHttps ? "https://" : "http://") + req.headers.host;

    // Remove configured headers from request
    corsAnywhere.removeHeaders.forEach(function (header) {
      delete req.headers[header];
    });

    // Set configured headers on request
    Object.keys(corsAnywhere.setHeaders).forEach(function (header) {
      req.headers[header] = corsAnywhere.setHeaders[header];
    });

    // Attach state to request for downstream use
    req.corsAnywhereRequestState.location = location;
    req.corsAnywhereRequestState.proxyBaseUrl = proxyBaseUrl;

    // Forward request to proxy server
    proxy.web(req, res, {
      target: location.href,
      changeOrigin: true,
      headers: {
        host: location.host,
      },
    });
  };
}
