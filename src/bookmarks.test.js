import test from "node:test";
import assert from "node:assert/strict";
import { bookmarkBackup, mergeBookmarks, parseBookmarkBackup } from "./bookmarks.js";

const validReference = (book, chapter, verses) => book === 1 && chapter === 1
  && (!verses || verses.every((verse) => verse <= 31));
const chapter = { id: "chapter", bookId: 1, chapterId: 1, verseIds: null, createdAt: 123, title: "Genesis 1" };
const verses = { id: "verses", bookId: 1, chapterId: 1, verseIds: [3, 1], createdAt: 456, title: "Genesis 1:1,3" };

test("bookmark backups round-trip and merge without duplicating passages", () => {
  const parsed = parseBookmarkBackup(bookmarkBackup([chapter, verses]), validReference);
  assert.deepEqual(parsed, [chapter, verses]);
  const duplicate = { ...verses, id: "another-id", verseIds: [1, 3] };
  const result = mergeBookmarks([chapter], [...parsed, duplicate]);
  assert.deepEqual(result, { bookmarks: [chapter, verses], added: 1 });
  assert.equal(mergeBookmarks(result.bookmarks, parsed).added, 0);
});

test("invalid backups and conflicting IDs are rejected without merging", () => {
  assert.throws(() => parseBookmarkBackup('{"bookmarks":[]}', validReference), /not a supported/);
  assert.throws(() => parseBookmarkBackup(bookmarkBackup([{ ...chapter, chapterId: 99 }]), validReference), /invalid/);
  assert.throws(() => parseBookmarkBackup(bookmarkBackup([{ ...verses, verseIds: [true] }]), validReference), /invalid/);
  assert.throws(() => parseBookmarkBackup(bookmarkBackup([{ ...verses, verseIds: [32] }]), validReference), /invalid/);
  assert.throws(() => mergeBookmarks([chapter], [{ ...verses, id: chapter.id }]), /conflicts/);
});
