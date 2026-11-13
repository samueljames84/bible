import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("dist");
const assets = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(filePath);
    } else if (entry.name !== "sw.js") {
      assets.push(path.relative(outputDirectory, filePath).replaceAll(path.sep, "/"));
    }
  }
}

await collect(outputDirectory);
assets.sort();
const hash = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
const script = `const CACHE_NAME = "bible-reader-${hash}";
const PRECACHE = ${JSON.stringify(assets)}.map((asset) => new URL(asset, self.registration.scope).href);
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("bible-reader-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
`;
await writeFile(path.join(outputDirectory, "sw.js"), script);
const database = await readFile(path.join(outputDirectory, "data", "bible.sqlite"));
console.log(`Generated offline cache worker for ${assets.length} assets (Bible database ${database.length.toLocaleString()} bytes).`);
