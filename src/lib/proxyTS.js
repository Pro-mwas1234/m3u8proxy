// src/lib/proxyTS.js — Transport Stream (.ts/.m4s) segment proxy
// ✅ Accepts baseUrl parameter for consistent URL rewriting

import axios from "axios";

export async function proxyTs(url, headers, req, res, baseUrl) {
  // ✅ Validate baseUrl
  if (!baseUrl) {
    console.error("proxyTs: baseUrl is required but was not provided");
    if (!res.headersSent) {
      res.status(500).send("Internal error: baseUrl not configured");
    }
    return;
  }

  try {
    // Stream the upstream segment directly to client
    const response = await axios({
      method: req.method || "GET",
      url: url,
      headers: headers,
      responseType: "stream",
      timeout: 60000, // 60 second timeout for large segments
    });

    // Copy relevant headers from upstream response
    const contentType = response.headers["content-type"] || "video/mp2t";
    const contentLength = response.headers["content-length"];
    const contentRange = response.headers["content-range"];
    const acceptRanges = response.headers["accept-ranges"];

    // ✅ Set response headers for media segment + CORS
    if (!res.headersSent) {
      res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
      
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, headers, url, Range");
      res.setHeader("Cache-Control", "public, max-age=3600"); // Cache segments
      
      // Pipe upstream stream to client response
      response.data.pipe(res);
    }

  } catch (err) {
    console.error("proxyTs error:", err.message);
    if (!res.headersSent) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(502).send(`Failed to fetch segment: ${err.message}`);
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
