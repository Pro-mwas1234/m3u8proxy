// src/index.js — Vercel Serverless Function Handler
// ✅ NO .listen(), NO createServer() — export handler only

import getHandler from "./lib/getHandler.js";
import httpProxy from "http-proxy";

export default async function handler(req, res) {
  // ✅ Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, headers, url");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }

  // ✅ Build DYNAMIC baseUrl from request headers (CRITICAL FIX)
  // This replaces hardcoded localhost/127.0.0.1 that caused EADDRNOTAVAIL
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const baseUrl = `${protocol}://${host}`; // e.g., https://your-project.vercel.app

  // ✅ Create http-proxy server instance (web mode, no .listen())
  const proxyServer = httpProxy.createProxyServer({
    xfwd: true,
    secure: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    changeOrigin: true,
  });

  // ✅ Prepare options for getHandler, including baseUrl
  const handlerOptions = {
    originBlacklist: ["*"],
    originWhitelist: process.env.ALLOWED_ORIGINS?.split(",") || [],
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
    baseUrl, // ✅ Pass baseUrl for URL rewriting in proxy functions
  };

  // ✅ Get request handler from your existing getHandler.js
  const requestHandler = getHandler(handlerOptions, proxyServer);

  // ✅ Handle proxy errors gracefully
  proxyServer.on("error", (err, proxyReq, proxyRes) => {
    console.error("Proxy error:", err);
    
    // If response already started, just end it
    if (proxyRes?.headersSent && !proxyRes?.writableEnded) {
      proxyRes.end();
      return;
    }
    
    // Clear any headers already set on res
    try {
      const headerNames = res.getHeaderNames?.() || Object.keys(res._headers || {});
      headerNames.forEach((name) => res.removeHeader(name));
    } catch (e) {
      // Ignore header cleanup errors
    }
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).send(`Proxy error: ${err.message}`);
  });

  // ✅ Execute the handler with Vercel's req/res objects
  try {
    await requestHandler(req, res);
  } catch (err) {
    console.error("Handler error:", err);
    if (!res.headersSent) {
      res.status(500).send(`Internal error: ${err.message}`);
    }
  }
}
