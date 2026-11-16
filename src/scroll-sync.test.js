import test from "node:test";
import assert from "node:assert/strict";
import { connectScrollSync } from "./scroll-sync.js";

function createPanes(secondMaximum = 1000) {
  const pending = [];
  class Pane extends EventTarget {
    constructor(maximum) {
      super();
      this.maximum = maximum;
      this.top = 0;
      this.writes = 0;
    }

    get scrollTop() {
      return this.top;
    }

    set scrollTop(value) {
      this.writes += 1;
      const next = Math.max(0, Math.min(this.maximum, value));
      if (next === this.top) return;
      this.top = next;
      pending.push(() => this.dispatchEvent(new Event("scroll")));
    }
  }
  const first = new Pane(1000);
  const second = new Pane(secondMaximum);
  connectScrollSync(first, second);
  return {
    first, second,
    flush() {
      let events = 0;
      while (pending.length) {
        assert.ok(++events < 50, "scroll events must not feed back indefinitely");
        pending.shift()();
      }
    },
  };
}

test("mirrors every source update without waiting for an animation frame", () => {
  const { first, second, flush } = createPanes();
  for (const top of [10.5, 20.25, 30.75]) {
    first.scrollTop = top;
    first.dispatchEvent(new Event("scroll"));
    assert.equal(second.scrollTop, top);
  }
  flush();
  assert.equal(first.writes, 3, "mirrored events must not write back to the source");
  assert.equal(second.writes, 3);
});

test("accepts a user scroll on the other pane before its mirrored event arrives", () => {
  const { first, second, flush } = createPanes();
  first.scrollTop = 100;
  first.dispatchEvent(new Event("scroll"));
  second.scrollTop = 80;
  flush();
  assert.equal(first.scrollTop, 80);
  assert.equal(second.scrollTop, 80);
});

test("a clamped follower must not pull the source backwards", () => {
  const { first, second, flush } = createPanes(50);
  first.scrollTop = 100;
  flush();
  assert.equal(first.scrollTop, 100);
  assert.equal(second.scrollTop, 50);
  second.scrollTop = 30;
  flush();
  assert.equal(first.scrollTop, 30);
});
