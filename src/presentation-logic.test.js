import test from "node:test";
import assert from "node:assert/strict";
import {
  availablePresentationVerses,
  lastPresentationStart,
  nextPresentationStart,
  presentationSlide,
} from "./presentation-logic.js";

test("slides advance by two references while displaying at most four verses", () => {
  const verses = availablePresentationVerses(
    Array.from({ length: 7 }, (_, index) => ({ verse_id: index + 1, verse_text: `Verse ${index + 1}` })),
  );
  const last = lastPresentationStart(verses);
  assert.equal(last, 7);
  assert.deepEqual(presentationSlide(verses, 1).map((verse) => verse.id), [1, 2, 3, 4]);
  assert.deepEqual(presentationSlide(verses, 3).map((verse) => verse.id), [3, 4, 5, 6]);
  assert.deepEqual(presentationSlide(verses, 7).map((verse) => verse.id), [7]);
  assert.equal(nextPresentationStart(1, -1, last), 1);
  assert.equal(nextPresentationStart(1, 1, last), 3);
  assert.equal(nextPresentationStart(7, 1, last), 7);
});

test("unavailable and cross-reference-only entries are skipped without renumbering", () => {
  const verses = availablePresentationVerses([
    { verse_id: 1, verse_text: "First" },
    { verse_id: 2, verse_text: "[Malayalam verse unavailable in this edition.]" },
    { verse_id: 3, verse_text: "[Combined with Malayalam verse 1.]" },
    { verse_id: 4, verse_text: "Fourth [Malayalam verses 4–5 are combined here.]" },
    { verse_id: 5, verse_text: "" },
    { verse_id: 6, verse_text: "Sixth" },
  ]);
  assert.deepEqual(verses.map((verse) => verse.id), [1, 4, 6]);
  assert.deepEqual(presentationSlide(verses, 3).map((verse) => verse.id), [4, 6]);
  assert.equal(lastPresentationStart(verses), 5);
  assert.deepEqual(presentationSlide(verses, 5).map((verse) => verse.id), [6]);
});
