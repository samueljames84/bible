import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import initSqlJs from "sql.js";

const SQL = await initSqlJs();
const database = new SQL.Database(await readFile(new URL("../public/data/bible.sqlite", import.meta.url)));

function verse(book, chapter, number) {
  const result = database.exec(
    "SELECT verse_text FROM verses WHERE book_id = ? AND chapter_id = ? AND verse_id = ?",
    [book, chapter, number],
  );
  assert.equal(result.length, 1, `Missing ${book}:${chapter}:${number}`);
  assert.equal(result[0].values.length, 1, `Duplicate ${book}:${chapter}:${number}`);
  return result[0].values[0][0];
}

test("Malayalam references match KJV without duplicates or verse zero", () => {
  assert.equal(database.exec("PRAGMA integrity_check")[0].values[0][0], "ok");
  assert.equal(database.exec("SELECT COUNT(*) FROM verses")[0].values[0][0], 31102);
  assert.deepEqual(database.exec(`
    SELECT book_id, chapter_id, verse_id FROM verses
    EXCEPT SELECT book_id, chapter_id, verse_id FROM verses_kjv
  `), []);
  assert.deepEqual(database.exec(`
    SELECT book_id, chapter_id, verse_id FROM verses_kjv
    EXCEPT SELECT book_id, chapter_id, verse_id FROM verses
  `), []);
});

test("moves confirmed boundary shifts without losing adjacent text", () => {
  assert.match(verse(2, 7, 25), /ഏഴ് ദിവസം/);
  assert.match(verse(2, 8, 1), /മോശെയോട്/);
  assert.match(verse(5, 12, 32), /ആജ്ഞാപിക്കുന്നതൊക്കെയും/);
  assert.match(verse(5, 13, 16), /കൊള്ളമുതൽ/);
  assert.match(verse(5, 13, 17), /ഉഗ്രകോപം/);
  assert.match(verse(5, 13, 18), /വാക്കുകേട്ട്/);
  assert.doesNotMatch(verse(5, 28, 68), /ഹോരേബിൽവച്ച്/);
  assert.match(verse(5, 29, 1), /ഹോരേബിൽവച്ച്/);
  assert.match(verse(5, 29, 29), /മറഞ്ഞിരിക്കുന്ന/);
  assert.match(verse(9, 30, 31), /ഹെബ്രോനിലുള്ളവർക്കും/);
  assert.match(verse(10, 17, 29), /തേൻ/);
  assert.match(verse(22, 6, 13), /ശൂലേംകാരീ/);
  assert.match(verse(22, 7, 11), /വെളിമ്പ്രദേശത്ത്/);
  assert.match(verse(22, 7, 12), /അതികാലത്ത്/);
  assert.match(verse(64, 1, 14), /മുഖാമുഖമായി.*സമാധാനം/);
});

test("clearly identifies unavailable and combined passages", () => {
  for (const reference of [[44, 15, 34], [44, 28, 29], [45, 16, 24]]) {
    assert.match(verse(...reference), /unavailable/);
  }
  for (const reference of [[44, 15, 26], [44, 15, 29], [45, 16, 26], [45, 16, 27], [55, 3, 7]]) {
    assert.match(verse(...reference), /Combined with/);
  }
  assert.match(verse(1, 1, 5), /source repeats/);
  assert.match(verse(44, 15, 18), /wording differs/);
  assert.match(verse(44, 15, 35), /പൗലൊസും/);
  assert.match(verse(66, 13, 1), /സർപ്പം കടൽപ്പുറത്തെ മണലിന്മേൽ നിന്നു/);
});
