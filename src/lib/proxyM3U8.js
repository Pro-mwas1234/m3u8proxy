// src/lib/proxyM3U8.js — m3u8 playlist proxy with dynamic baseUrl
// ✅ Accepts baseUrl parameter, replaces all hardcoded localhost references

import axios from "axios";

export default async function proxyM3U8(url, headers, res, baseUrl) {
  // ✅ Validate baseUrl — fallback for safety (should never happen in production)
  if (!baseUrl) {
    console.error("proxyM3U8: baseUrl is required but was not provided");
    res.status(500).send("Internal error: baseUrl not configured");
    return;
  }

  // Fetch the upstream m3u8 playlist
  const req = await axios(url, {
    headers: headers,
    timeout: 30000, // 30 second timeout
  }).catch((err) => {
    if (!res.headersSent) {
      res.status(500).send(err.message || "Failed to fetch m3u8");
    }
    return null;
  });
  
  if (!req) return;

  // Filter out audio-only streams if needed
  let m3u8 = req.data
    .split("\n")
    .filter((line) => !line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO"))
    .join("\n");

  const lines = m3u8.split("\n");
  const newLines = [];

  for (const line of lines) {
    if (line.startsWith("#")) {
      // Handle #EXT-X-KEY encryption keys
      if (line.startsWith("#EXT-X-KEY:")) {
        const regex = /https?:\/\/[^\""\s]+/g;
        const keyUrl = regex.exec(line)?.[0];
        if (keyUrl) {
          // ✅ Rewrite key URL to use baseUrl (NOT localhost)
          const proxiedKey = `${baseUrl}/ts-proxy?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
          newLines.push(line.replace(regex, proxiedKey));
        } else {
          newLines.push(line);
        }
      } else {
        // Pass through other # tags unchanged
        newLines.push(line);
      }
    } else if (line.trim()) {
      // Rewrite segment/playlist URLs
      try {
        const uri = new URL(line, url); // Resolve relative to source playlist
        // ✅ Rewrite to use baseUrl
        const proxiedUrl = `${baseUrl}/ts-proxy?url=${encodeURIComponent(uri.href)}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
        newLines.push(proxiedUrl);
      } catch (e) {
        console.warn("proxyM3U8: Failed to parse URL:", line, e.message);
        // Fallback: keep original line if parsing fails
        newLines.push(line);
      }
    } else {
      // Empty lines pass through
      newLines.push(line);
    }
  }

  // ✅ Set response headers for m3u8 content + CORS
  if (!res.headersSent) {
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, headers, url");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    
    res.status(200).send(newLines.join("\n"));
  }
}
