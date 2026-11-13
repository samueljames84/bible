import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ZOOM, readZoom, ZOOM_OPTIONS } from "./zoom.js";

test("requested zoom levels are restored from saved settings", () => {
  for (const [level] of ZOOM_OPTIONS) {
    assert.equal(readZoom({ zoom: String(level) }), level);
  }
});

test("previous font sizes and zoom levels migrate to the nearest available level", () => {
  assert.equal(readZoom({ fontSize: "22" }), 150);
  assert.equal(readZoom({ fontSize: "8" }), 100);
  assert.equal(readZoom({ zoom: 80 }), 100);
  assert.equal(readZoom({ zoom: 125 }), 100);
  assert.equal(readZoom({ zoom: 137.5, fontSize: "16" }), 150);
  assert.equal(readZoom({ zoom: 300 }), 250);
  assert.equal(readZoom({ zoom: "invalid" }), DEFAULT_ZOOM);
});
