const BACKUP_FORMAT = "bible-reader-bookmarks";
const BACKUP_VERSION = 1;

export function bookmarkBackup(bookmarks) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, bookmarks }, null, 2);
}

export function parseBookmarkBackup(text, validReference) {
  const data = JSON.parse(text);
  if (!data || data.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION || !Array.isArray(data.bookmarks)) {
    throw new Error("This is not a supported Bible bookmark backup.");
  }
  return data.bookmarks.map((bookmark, index) => {
    const invalid = () => { throw new Error(`Bookmark ${index + 1} is invalid.`); };
    if (!bookmark || typeof bookmark !== "object" || typeof bookmark.id !== "string" || !bookmark.id) invalid();
    const numeric = (value) => typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value));
    const bookId = Number(bookmark.bookId);
    const chapterId = Number(bookmark.chapterId);
    const createdAt = Number(bookmark.createdAt);
    if (!numeric(bookmark.bookId) || !Number.isInteger(bookId) || bookId < 1
      || !numeric(bookmark.chapterId) || !Number.isInteger(chapterId) || chapterId < 1
      || !numeric(bookmark.createdAt) || !Number.isFinite(createdAt) || !Number.isFinite(new Date(createdAt).getTime())
      || (bookmark.title != null && typeof bookmark.title !== "string")
      || (bookmark.verseIds != null && !Array.isArray(bookmark.verseIds))) invalid();
    if (bookmark.verseIds?.some((verse) => !numeric(verse))) invalid();
    const verseIds = bookmark.verseIds == null ? null : bookmark.verseIds.map(Number);
    if (verseIds && verseIds.some((verse) => !Number.isInteger(verse) || verse < 1)) invalid();
    if (!validReference(bookId, chapterId, verseIds)) invalid();
    return { ...bookmark, bookId, chapterId, verseIds, createdAt };
  });
}

function referenceKey(bookmark) {
  const verses = [...new Set(bookmark.verseIds || [])].sort((a, b) => a - b);
  return `${bookmark.bookId}:${bookmark.chapterId}:${verses.join(",")}`;
}

export function mergeBookmarks(existing, incoming) {
  const result = [...existing];
  const ids = new Map(existing.map((bookmark) => [bookmark.id, referenceKey(bookmark)]));
  const references = new Set(existing.map(referenceKey));
  let added = 0;
  for (const bookmark of incoming) {
    const reference = referenceKey(bookmark);
    if (ids.has(bookmark.id) && ids.get(bookmark.id) !== reference) {
      throw new Error("A bookmark ID conflicts with a different saved passage.");
    }
    if (!ids.has(bookmark.id) && !references.has(reference)) {
      result.push(bookmark);
      added += 1;
    }
    ids.set(bookmark.id, reference);
    references.add(reference);
  }
  return { bookmarks: result, added };
}
