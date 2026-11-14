import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

test("offline cache changes with database content and matches precached variants", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bible-cache-test-"));
  const dist = path.join(directory, "dist");
  const generator = fileURLToPath(new URL("../scripts/generate-sw.mjs", import.meta.url));
  try {
    await mkdir(path.join(dist, "data"), { recursive: true });
    await writeFile(path.join(dist, "index.html"), "index");
    await writeFile(path.join(dist, "presentation.html"), "presentation");
    const database = path.join(dist, "data", "bible.sqlite");
    await writeFile(database, "first");
    execFileSync(process.execPath, [generator], { cwd: directory });
    const first = await readFile(path.join(dist, "sw.js"), "utf8");
    await writeFile(database, "second");
    execFileSync(process.execPath, [generator], { cwd: directory });
    const second = await readFile(path.join(dist, "sw.js"), "utf8");
    assert.notEqual(first.match(/bible-reader-[a-f0-9]+/)[0], second.match(/bible-reader-[a-f0-9]+/)[0]);

    const handlers = {};
    let matchOptions;
    let matchedRequest;
    const context = {
      URL,
      self: {
        registration: { scope: "https://example.test/" },
        location: { origin: "https://example.test" },
        addEventListener: (name, handler) => { handlers[name] = handler; },
      },
      caches: {
        match: async (request, options) => {
          matchedRequest = request;
          matchOptions = options;
          return "cached";
        },
      },
    };
    vm.runInNewContext(second, context);
    let response;
    handlers.fetch({
      request: { method: "GET", url: "https://example.test/data/bible.sqlite" },
      respondWith: (promise) => { response = promise; },
    });
    assert.equal(await response, "cached");
    assert.equal(matchOptions.ignoreVary, true);

    handlers.fetch({
      request: { method: "GET", mode: "navigate", url: "https://example.test/presentation.html?book=1&chapter=1&language=ta" },
      respondWith: (promise) => { response = promise; },
    });
    assert.equal(await response, "cached");
    assert.equal(matchedRequest, "https://example.test/presentation.html");
    assert.equal(matchOptions.ignoreVary, true);

    handlers.fetch({
      request: { method: "GET", url: "https://example.test/" },
      respondWith: (promise) => { response = promise; },
    });
    assert.equal(await response, "cached");
    assert.equal(matchOptions.ignoreVary, true);

    handlers.fetch({
      request: { method: "GET", url: "https://example.test/other" },
      respondWith: (promise) => { response = promise; },
    });
    assert.equal(await response, "cached");
    assert.equal(matchOptions, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
