import test from "node:test";
import assert from "node:assert/strict";
import { buildVersePairs, formatVerseRanges, getLanguage, getTranslationTable } from "./catalog.js";

test("maps the three editions to the correct database tables", () => {
  assert.equal(getTranslationTable("ml"), "verses");
  assert.equal(getTranslationTable("kjv"), "verses_kjv");
  assert.equal(getTranslationTable("asv"), "verses_asv");
  assert.equal(getLanguage("unknown").id, "ml");
});

test("aligns translations by verse number even when a verse is absent", () => {
  const pairs = buildVersePairs(
    [{ verse_id: 1, verse_text: "ഒന്ന്" }, { verse_id: 3, verse_text: "മൂന്ന്" }],
    [{ verse_id: 1, verse_text: "one" }, { verse_id: 2, verse_text: "two" }],
  );
  assert.deepEqual(pairs, [
    { verseId: 1, primary: "ഒന്ന്", secondary: "one" },
    { verseId: 2, primary: "", secondary: "two" },
    { verseId: 3, primary: "മൂന്ന്", secondary: "" },
  ]);
});

test("compresses selected verses into bookmark-style ranges", () => {
  assert.equal(formatVerseRanges([4, 2, 1, 3, 8, 8]), "1-4,8");
  assert.equal(formatVerseRanges([]), "");
  assert.equal(formatVerseRanges([0, -1, 2.5, 6]), "6");
});
