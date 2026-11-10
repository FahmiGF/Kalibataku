import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT) || 4176;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function resolveFilePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  } catch {
    return null;
  }

  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const target = resolve(root, `.${pathname}`);

  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  return target;
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "GET, HEAD",
      "Cache-Control": "no-cache",
    });
    response.end("Metode tidak diizinkan");
    return;
  }

  if ((request.url ?? "").startsWith("/favicon.ico")) {
    response.writeHead(204, { "Cache-Control": "no-cache" });
    response.end();
    return;
  }

  const target = resolveFilePath(request.url);

  let isFile = false;
  try {
    isFile = Boolean(target) && existsSync(target) && statSync(target).isFile();
  } catch {
    isFile = false;
  }

  if (!target || !isFile) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    response.end("Halaman tidak ditemukan");
    return;
  }

  const headers = {
    "Content-Type": contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };

  if (request.method === "HEAD") {
    response.writeHead(200, headers);
    response.end();
    return;
  }

  response.writeHead(200, headers);
  createReadStream(target)
    .on("error", () => {
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end("Gagal membaca berkas");
    })
    .pipe(response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Kalibataku berjalan di http://localhost:${port}`);
  console.log("Tekan Ctrl+C untuk berhenti.");
});
