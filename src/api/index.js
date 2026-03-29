// api/index.js — Vercel Serverless Function Handler
// ✅ Location: project root /api/index.js (NOT src/)
// ✅ Imports: use "./src/lib/..." because this file is at root level
// ✅ Exports: default async handler(req, res) — NO .listen(), NO createServer()

import getHandler from "./src/lib/getHandler.js";
import httpProxy from "http-proxy";

export default async function handler(req, res) {
  // ✅ Handle CORS preflight requests (must come first)
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, headers, url, Range, X-Requested-With");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    return res.status(204).end();
  }

  // ✅ Build DYNAMIC baseUrl from request headers (CRITICAL FIX)
  // This replaces hardcoded localhost/127.0.0.1 that caused EADDRNOTAVAIL ::1:80
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const baseUrl = `${protocol}://${host}`; // e.g., https://your-project.vercel.app

  // ✅ Create http-proxy server instance (web mode — NO .listen())
  const proxyServer = httpProxy.createProxyServer({
    xfwd: true,
    secure: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    changeOrigin: true,
    followRedirects: true,
  });

  // ✅ Prepare options for getHandler, including baseUrl for URL rewriting
  const handlerOptions = {
    originBlacklist: ["*"],
    originWhitelist: process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || [],
    requireHeader: [],
    removeHeaders: [
      "cookie",
      "cookie2",
      "x-request-start",
      "x-request-id",
      "via",
      "connect-time",
      "total-route-time",
    ],
    redirectSameOrigin: true,
    httpProxyOptions: { xfwd: false },
    baseUrl, // ✅ Pass baseUrl so proxy functions rewrite URLs correctly
  };

  // ✅ Get request handler from your existing getHandler.js
  const requestHandler = getHandler(handlerOptions, proxyServer);

  // ✅ Handle proxy errors gracefully (network failures, upstream errors, etc.)
  proxyServer.on("error", (err, proxyReq, proxyRes) => {
    console.error("Proxy error:", err);
    
    // If response already started, just end it to avoid "headers already sent"
    if (proxyRes?.headersSent && !proxyRes?.writableEnded) {
      try { proxyRes.end(); } catch (e) { /* ignore */ }
      return;
    }
    
    // Clear any headers already set on res to avoid conflicts
    try {
      const headerNames = typeof res.getHeaderNames === "function" 
        ? res.getHeaderNames() 
        : Object.keys(res._headers || {});
      headerNames.forEach((name) => {
        try { res.removeHeader(name); } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore header cleanup errors */ }
    
    // Send error response with CORS headers
    if (!res.headersSent) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.status(502).send(`Proxy error: ${err.message || err}`);
    }
  });

  // ✅ Execute the handler with Vercel's req/res objects
  try {
    await requestHandler(req, res);
  } catch (err) {
    console.error("Handler execution error:", err);
    if (!res.headersSent) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(500).send(`Internal error: ${err.message || err}`);
    } else if (!res.writableEnded) {
      try { res.end(); } catch (e) { /* ignore */ }
    }
  }
}
