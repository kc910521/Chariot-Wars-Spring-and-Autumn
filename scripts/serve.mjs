// Minimal static file server for local play. Usage:
//   node scripts/serve.mjs [port]
// The repository has no dependencies, so this uses only Node's standard
// library. Unlike python's `http.server` (listen backlog 5) it accepts the whole
// burst of ES module requests Chrome opens, so the page never fails to load.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.argv[2] ?? 8000);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
};

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  const relativePath = normalize(pathname === "/" ? "index.html" : pathname).replace(/^([/\\])+/, "");
  const filePath = join(projectRoot, relativePath);
  return filePath.startsWith(projectRoot) ? filePath : null;
}

const server = createServer((request, response) => {
  const filePath = resolveRequestPath(request.url);
  let stats;
  try {
    if (!filePath) throw new Error("outside project root");
    stats = statSync(filePath);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  if (!stats.isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    // Revalidate every load so edited modules show up without a hard refresh.
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(response);
});

server.listen({ port, host: "127.0.0.1", backlog: 511 }, () => {
  console.log(`h5game served from ${projectRoot} at http://localhost:${port}`);
});
