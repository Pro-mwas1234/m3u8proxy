// api/index.js
import getHandler from "./src/lib/getHandler.js";
import httpProxy from "http-proxy";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, headers, url, Range, X-Requested-With");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }

  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const baseUrl = `${protocol}://${host}`;

  const proxyServer = httpProxy.createProxyServer({
    xfwd: true,
    secure: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    changeOrigin: true,
  });

  const handlerOptions = {
    originBlacklist: ["*"],
    originWhitelist: process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || [],
    requireHeader: [],
    removeHeaders: ["cookie", "cookie2", "x-request-start", "x-request-id", "via", "connect-time", "total-route-time"],
    redirectSameOrigin: true,
    httpProxyOptions: { xfwd: false },
    baseUrl, 
  };

  const requestHandler = getHandler(handlerOptions, proxyServer);

  proxyServer.on("error", (err) => {
    console.error("Proxy error:", err);
    if (!res.headersSent) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(502).send(`Proxy error: ${err.message}`);
    }
  });

  try {
    await requestHandler(req, res);
  } catch (err) {
    console.error("Handler error:", err);
    if (!res.headersSent) {
      res.status(500).send(`Internal error: ${err.message}`);
    }
  }
}
