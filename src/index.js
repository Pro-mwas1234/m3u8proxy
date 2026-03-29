// src/index.js (Vercel Serverless Handler)
import getHandler from "./lib/getHandler.js";
import httpProxy from "http-proxy";

export default async function handler(req, res) {
  // ✅ Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  // ✅ Build DYNAMIC baseUrl from request (CRITICAL)
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const baseUrl = `${protocol}://${host}`; // e.g., https://your-project.vercel.app

  // ✅ Create proxy server
  const proxyServer = httpProxy.createProxyServer({
    xfwd: true,
    secure: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
  });

  // ✅ Pass baseUrl to getHandler via options
  const requestHandler = getHandler(
    {
      originBlacklist: ["*"],
      originWhitelist: process.env.ALLOWED_ORIGINS?.split(",") || [],
      requireHeader: [],
      removeHeaders: ["cookie", "cookie2", "x-request-start", "x-request-id", "via", "connect-time", "total-route-time"],
      redirectSameOrigin: true,
      httpProxyOptions: { xfwd: false },
      baseUrl, // ✅ ADD THIS
    },
    proxyServer
  );

  // ✅ Error handling
  proxyServer.on("error", (err, proxyReq, proxyRes) => {
    console.error("Proxy error:", err);
    if (proxyRes?.headersSent && !proxyRes?.writableEnded) {
      proxyRes.end();
      return;
    }
    const headerNames = res.getHeaderNames?.() || Object.keys(res._headers || {});
    headerNames.forEach((name) => res.removeHeader(name));
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).send(`Proxy error: ${err.message}`);
  });

  // ✅ Execute handler
  requestHandler(req, res);
}
