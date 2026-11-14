import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  buildVersePairs,
  DEFAULT_PRIMARY_LANGUAGE,
  DEFAULT_SECONDARY_LANGUAGE,
  formatVerseRanges,
  getLanguage,
  getTranslationTable,
  LANGUAGES,
  LAYOUTS,
  readSecondView,
} from "./catalog.js";
import { DEFAULT_ZOOM, readZoom, ZOOM_OPTIONS } from "./zoom.js";
import { bookmarkBackup, mergeBookmarks, parseBookmarkBackup } from "./bookmarks.js";
import "./style.css";

const app = document.querySelector("#app");
const SETTINGS_KEY = "bible-reader.settings";
const BOOKMARKS_KEY = "bible-reader.bookmarks";
const LAST_POSITION_KEY = "bible-reader.last-position";
const APP_ICON_URL = `${import.meta.env.BASE_URL}icon-192.png`;
const BookmarkBackup = registerPlugin("BookmarkBackup");
const DEFAULT_SETTINGS = Object.freeze({
  primary: DEFAULT_PRIMARY_LANGUAGE,
  secondary: DEFAULT_SECONDARY_LANGUAGE,
  secondaryEnabled: true,
  layout: "balanced",
  zoom: DEFAULT_ZOOM,
  theme: "green",
  rendering: "0",
  readingBold: false,
  groupBookmarks: false,
  bookmarkOnLongPress: true,
});
const THEMES = [
  ["white", "White"],
  ["dark-black", "Black"],
  ["dark-grey", "Dark Grey"],
  ["dark-green", "Dark Green"],
  ["maroon", "Maroon"],
  ["green", "Light Green"],
  ["yellow", "Light Yellow"],
];
const RENDERING_OPTIONS = [
  ["0", "Default Fix"],
  ["1", "Alternate Fix (LG Models)"],
  ["2", "No Fix"],
];

let db;
let books = [];
let currentBook;
let currentChapter = 1;
let chapterVerses = [];
let selectedVerses = new Set();
let activeView = "books";
let returnView = "books";
let bookFilter = "";
let noticeTimer;
let longPressTimer;
let longPressTriggered = false;
let parallelScrollLock = false;
let parallelResizeObserver;
let lastPosition;
let settings = readSettings();

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const next = { ...DEFAULT_SETTINGS, ...stored, zoom: readZoom(stored) };
    Object.assign(next, readSecondView(stored));
    delete next.fontSize;
    delete next.presentationBold;
    if (!LANGUAGES.some((language) => language.id === next.primary)) next.primary = DEFAULT_SETTINGS.primary;
    if (!LAYOUTS.some((layout) => layout.id === next.layout)) next.layout = DEFAULT_SETTINGS.layout;
    if (next.theme === "black") next.theme = "dark-green";
    if (!THEMES.some(([theme]) => theme === next.theme)) next.theme = DEFAULT_SETTINGS.theme;
    if (!RENDERING_OPTIONS.some(([mode]) => mode === String(next.rendering))) next.rendering = DEFAULT_SETTINGS.rendering;
    next.rendering = String(next.rendering);
    next.readingBold = next.readingBold === true;
    next.groupBookmarks = Boolean(next.groupBookmarks);
    next.bookmarkOnLongPress = Boolean(next.bookmarkOnLongPress);
    return next;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function notify(message) {
  window.clearTimeout(noticeTimer);
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  noticeTimer = window.setTimeout(() => toast.remove(), 3600);
}

function setSettings(next) {
  settings = { ...settings, ...next };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    notify(`Could not save settings: ${error.message}`);
  }
  render();
}

function readBookmarks() {
  try {
    const value = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
    return Array.isArray(value) ? value.filter(isValidBookmark) : [];
  } catch (error) {
    notify(`Could not read saved bookmarks: ${error.message}`);
    return [];
  }
}

function isValidBookmark(bookmark) {
  return bookmark !== null
    && typeof bookmark === "object"
    && Number.isInteger(Number(bookmark.bookId))
    && Number.isInteger(Number(bookmark.chapterId))
    && typeof bookmark.id === "string"
    && Number.isFinite(Number(bookmark.createdAt))
    && (bookmark.verseIds == null || Array.isArray(bookmark.verseIds));
}

function writeBookmarks(bookmarks) {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    return true;
  } catch (error) {
    notify(`Could not save bookmark: ${error.message}`);
    return false;
  }
}

function bookById(bookId) {
  return books.find((book) => Number(book.book_id) === Number(bookId));
}

function bookName(book, languageId) {
  if (!book) return "";
  return book[getLanguage(languageId).bookName];
}

function getVerses(languageId, bookId, chapterId) {
  const table = getTranslationTable(languageId);
  const statement = db.prepare(
    `SELECT verse_id, verse_text FROM ${table} WHERE book_id = ? AND chapter_id = ? ORDER BY verse_id`,
  );
  const verses = [];
  try {
    statement.bind([Number(bookId), Number(chapterId)]);
    while (statement.step()) verses.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return verses;
}

function bookmarkReferenceValidator() {
  const chapterVerses = new Map();
  return (bookId, chapterId, verseIds) => {
    const book = bookById(bookId);
    if (!book || chapterId > book.num_chptr) return false;
    if (!verseIds?.length) return true;
    const key = `${bookId}:${chapterId}`;
    if (!chapterVerses.has(key)) {
      chapterVerses.set(key, new Set(LANGUAGES.flatMap((language) =>
        getVerses(language.id, bookId, chapterId).map((verse) => Number(verse.verse_id)))));
    }
    return verseIds.every((verseId) => chapterVerses.get(key).has(verseId));
  };
}

function storedBookmarksForBackup(validReference) {
  const stored = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
  return parseBookmarkBackup(bookmarkBackup(stored), validReference);
}

async function exportBookmarks() {
  try {
    const bookmarks = storedBookmarksForBackup(bookmarkReferenceValidator());
    const content = bookmarkBackup(bookmarks);
    if (Capacitor.isNativePlatform()) {
      const result = await BookmarkBackup.exportFile({ content });
      if (!result.cancelled) notify("Bookmarks exported.");
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bible-bookmarks.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    notify("Bookmark download started.");
  } catch (error) {
    notify(`Could not export bookmarks: ${error.message}`);
    console.error(error);
  }
}

async function importBookmarks(file) {
  try {
    const validReference = bookmarkReferenceValidator();
    const incoming = parseBookmarkBackup(await file.text(), validReference);
    const existing = storedBookmarksForBackup(validReference);
    const result = mergeBookmarks(existing, incoming);
    if (result.added && !writeBookmarks(result.bookmarks)) return;
    render();
    notify(`Imported ${result.added} bookmark${result.added === 1 ? "" : "s"}; duplicates skipped.`);
  } catch (error) {
    notify(`Could not import bookmarks: ${error.message}`);
    console.error(error);
  }
}

function loadChapter(book, chapterId, verseIds = null) {
  if (!book || chapterId < 1 || chapterId > Number(book.num_chptr)) {
    notify("That chapter is not available.");
    return;
  }
  const nextChapter = Number(chapterId);
  try {
    const primary = getVerses(settings.primary, book.book_id, nextChapter);
    const secondary = !settings.secondaryEnabled
      ? []
      : getVerses(settings.secondary, book.book_id, nextChapter);
    chapterVerses = buildVersePairs(primary, secondary);
  } catch (error) {
    notify(`Could not load chapter: ${error.message}`);
    console.error(error);
    return;
  }
  currentBook = book;
  currentChapter = nextChapter;
  selectedVerses = new Set((verseIds || []).map(Number).filter(Number.isInteger));
  activeView = "reader";
  lastPosition = { bookId: Number(book.book_id), chapterId: currentChapter };
  try {
    localStorage.setItem(LAST_POSITION_KEY, JSON.stringify(lastPosition));
  } catch (error) {
    notify(`Could not save reading position: ${error.message}`);
  }
  render();
  window.scrollTo(0, 0);
}

function queryBooks() {
  const result = db.exec(
    "SELECT books.book_id, EnglishShortName, MalayalamShortName, TamilShortName, num_chptr FROM books JOIN tamil_books ON books.book_id = tamil_books.book_id ORDER BY books.book_id",
  );
  if (!result[0]?.values) throw new Error("The Bible database does not contain its book list.");
  return result[0].values.map(([book_id, EnglishShortName, MalayalamShortName, TamilShortName, num_chptr]) => ({
    book_id: Number(book_id),
    EnglishShortName,
    MalayalamShortName,
    TamilShortName,
    num_chptr: Number(num_chptr),
  }));
}

function renderHeader() {
  return `<header class="app-header">
    <button class="brand" type="button" data-action="home" aria-label="Go to books">
      <img class="brand-mark" src="${APP_ICON_URL}" alt="">
      <span><strong>Bible</strong><small>Offline reader</small></span>
    </button>
    <nav class="header-actions" aria-label="App">
      <button class="quiet-button" type="button" data-action="bookmarks">Bookmarks</button>
      <button class="quiet-button" type="button" data-action="settings">Settings</button>
      <button class="icon-button" type="button" data-action="info" aria-label="Information" title="Information">ⓘ</button>
    </nav>
  </header>`;
}

function render() {
  parallelResizeObserver?.disconnect();
  parallelResizeObserver = undefined;
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.view = activeView;
  document.documentElement.dataset.readingBold = String(settings.readingBold);
  document.documentElement.style.setProperty("--reading-size", `${16 * settings.zoom / 100}px`);
  const screen = activeView === "books" ? renderBooks()
    : activeView === "chapters" ? renderChapters()
      : activeView === "reader" ? renderReader()
        : activeView === "bookmarks" ? renderBookmarks()
          : activeView === "settings" ? renderSettings()
            : renderInfo();
  app.innerHTML = activeView === "reader" ? screen : `${renderHeader()}${screen}`;
  app.onclick = handleClick;
  app.onpointerdown = handlePointerDown;
  app.onpointerup = clearLongPress;
  app.onpointercancel = clearLongPress;
  app.oncontextmenu = handleContextMenu;
  app.onchange = handleChange;
  app.oninput = handleInput;
  if (activeView === "reader" && settings.secondaryEnabled && ["balanced", "parallel"].includes(settings.layout)) {
    connectParallelScroll();
  }
}

function renderBooks() {
  const normalizedFilter = bookFilter.trim().toLocaleLowerCase();
  const visibleBooks = books.filter((book) => {
    const names = `${book.EnglishShortName} ${book.MalayalamShortName} ${book.TamilShortName}`.toLocaleLowerCase();
    return names.includes(normalizedFilter);
  });
  const oldTestament = visibleBooks.filter((book) => book.book_id <= 39);
  const newTestament = visibleBooks.filter((book) => book.book_id > 39);
  const continueBook = lastPosition ? bookById(lastPosition.bookId) : null;
  return `<main class="page">
    <section class="welcome-card">
      <div>
        <p class="eyebrow">A quiet place to read</p>
        <h1>Read in Tamil, Malayalam and English.</h1>
        <p>All 66 books are included for offline reading. Choose a book to begin.</p>
      </div>
      <span class="welcome-symbol" aria-hidden="true">${escapeHtml(getLanguage(settings.primary).bibleName)}</span>
    </section>
    ${continueBook ? `<button class="continue-card" type="button" data-action="continue-reading">
      <span><small>Continue reading</small><strong>${escapeHtml(bookName(continueBook, settings.primary))} ${lastPosition.chapterId}</strong></span>
      <span class="continue-arrow" aria-hidden="true">→</span>
    </button>` : ""}
    <div class="section-heading book-heading">
      <div><p class="eyebrow">The library</p><h2>Books of the Bible</h2></div>
      <label class="search-box"><span class="sr-only">Search books</span><input id="book-search" type="search" value="${escapeHtml(bookFilter)}" placeholder="Find a book" autocomplete="off"></label>
    </div>
    ${renderBookSection("Old Testament", oldTestament, "old-testament")}
    ${renderBookSection("New Testament", newTestament, "new-testament")}
    ${visibleBooks.length === 0 ? `<p class="empty-state">No books match that search.</p>` : ""}
  </main>`;
}

function renderBookSection(title, sectionBooks, testamentClass) {
  if (!sectionBooks.length) return "";
  return `<section class="book-section ${testamentClass}"><h3>${title}</h3><div class="book-grid">
    ${sectionBooks.map((book) => `<button class="book-card" type="button" data-action="open-book" data-book-id="${book.book_id}">
      <span class="book-card-top"><strong>${escapeHtml(bookName(book, settings.primary))}</strong><span aria-hidden="true">›</span></span>
      ${settings.secondaryEnabled ? `<small>${escapeHtml(bookName(book, settings.secondary))}</small>` : ""}
      <small>${book.num_chptr} chapters</small>
    </button>`).join("")}
  </div></section>`;
}

function renderChapters() {
  if (!currentBook) return renderBooks();
  const primaryName = bookName(currentBook, settings.primary);
  const secondaryName = settings.secondaryEnabled ? bookName(currentBook, settings.secondary) : "";
  return `<main class="page narrow-page">
    <div class="page-topline"><button class="back-button" type="button" data-action="home">← Books</button><span class="eyebrow">Choose a chapter</span></div>
    <h1>${escapeHtml(primaryName)}</h1>
    ${secondaryName && secondaryName !== primaryName ? `<p class="translation-subtitle">${escapeHtml(secondaryName)}</p>` : ""}
    <p class="muted">${currentBook.num_chptr} chapters</p>
    <div class="chapter-grid" aria-label="Chapters">
      ${Array.from({ length: currentBook.num_chptr }, (_, index) => `<button type="button" class="chapter-button" data-action="open-chapter" data-chapter-id="${index + 1}">${index + 1}</button>`).join("")}
    </div>
  </main>`;
}

function renderReader() {
  if (!currentBook) return renderBooks();
  const chapterOptions = Array.from({ length: currentBook.num_chptr }, (_, index) => {
    const chapter = index + 1;
    return `<option value="${chapter}" ${chapter === currentChapter ? "selected" : ""}>${chapter}</option>`;
  }).join("");
  const hasSelection = selectedVerses.size > 0;
  const balanced = settings.secondaryEnabled && settings.layout === "balanced";
  const readerContent = renderReaderContent();
  const webPresentation = !Capacitor.isNativePlatform();
  const presentationParams = new URLSearchParams({
    book: String(currentBook.book_id),
    chapter: String(currentChapter),
    language: settings.primary,
  });
  return `<main class="reader-page ${balanced ? "is-balanced-reader" : ""}">
    <header class="reader-toolbar ${webPresentation ? "has-presentation" : ""}">
      <button class="reader-back icon-button" type="button" data-action="chapters" aria-label="Choose a chapter" title="Choose a chapter">‹</button>
      <div class="reader-location">
        <strong>${escapeHtml(bookName(currentBook, settings.primary))}</strong>
        <span>${escapeHtml(getLanguage(settings.primary).label)}${settings.secondaryEnabled ? ` · ${escapeHtml(getLanguage(settings.secondary).label)}` : ""}</span>
      </div>
      <label class="chapter-picker"><span class="sr-only">Choose chapter</span><select data-select="chapter" aria-label="Choose chapter">${chapterOptions}</select></label>
      ${webPresentation ? `<a class="presentation-button" href="${import.meta.env.BASE_URL}presentation.html?${escapeHtml(presentationParams)}" target="_blank" rel="noopener">Open Presentation</a>` : ""}
      <details class="reader-overflow">
        <summary class="icon-button" aria-label="More options" title="More options">⋮</summary>
        <nav class="reader-overflow-menu" aria-label="More reading options">
          <button type="button" data-action="home">Books</button>
          <button type="button" data-action="bookmarks">Bookmarks</button>
          <button type="button" data-action="settings">Settings</button>
          <button type="button" data-action="info">About</button>
        </nav>
      </details>
    </header>
    <section class="reader-content ${balanced ? "balanced-reader-content" : ""}">${readerContent}</section>
    <footer class="reader-footer" aria-label="Chapter navigation">
      <button class="reader-nav-button" type="button" data-action="previous" ${canGoPrevious() ? "" : "disabled"} aria-label="Previous chapter" title="Previous chapter"><span aria-hidden="true">←</span></button>
      ${hasSelection ? `<div class="reader-footer-center selection-center">
        <span class="selection-count" aria-live="polite">${selectedVerses.size} selected</span>
        <div class="reader-selection-actions" role="toolbar" aria-label="Selected verse actions">
          <button class="reader-action-button" type="button" data-action="copy" aria-label="Copy selected verses" title="Copy">⧉</button>
          <button class="reader-action-button" type="button" data-action="share" aria-label="Share selected verses" title="Share">↗</button>
          <button class="reader-action-button" type="button" data-action="bookmark-selection" aria-label="Bookmark selected verses" title="Bookmark">☆</button>
          <button class="reader-action-button" type="button" data-action="clear-selection" aria-label="Clear selection" title="Clear selection">×</button>
        </div>
      </div>` : `<div class="reader-footer-center">
        <span class="chapter-reference"><strong>${escapeHtml(bookName(currentBook, settings.primary))} ${currentChapter}</strong><small>${currentChapter} of ${currentBook.num_chptr} chapters</small></span>
        <button class="reader-bookmark" type="button" data-action="bookmark-chapter" aria-label="Bookmark chapter" title="Bookmark chapter">☆</button>
      </div>`}
      <button class="reader-nav-button" type="button" data-action="next" ${canGoNext() ? "" : "disabled"} aria-label="Next chapter" title="Next chapter"><span aria-hidden="true">→</span></button>
    </footer>
  </main>`;
}

function verseButton(verseId, languageId, text) {
  const selected = selectedVerses.has(verseId);
  return `<button type="button" class="verse-text ${selected ? "is-selected" : ""}" data-action="toggle-verse" data-verse-id="${verseId}" aria-pressed="${selected}" lang="${languageId === "ml" || languageId === "ta" ? languageId : "en"}">
    <span class="verse-number">${verseId}</span><span>${escapeHtml(text)}</span>
  </button>`;
}

function renderReaderContent() {
  if (!settings.secondaryEnabled) {
    return `<div class="single-language-list">${chapterVerses.map((verse) => verseButton(verse.verseId, settings.primary, verse.primary)).join("")}</div>`;
  }
  if (settings.layout === "verse") {
    return `<div class="verse-by-verse">${chapterVerses.map((verse) => `<article class="paired-verse">
      <div class="verse-language-label">${escapeHtml(getLanguage(settings.primary).label)}</div>
      ${verseButton(verse.verseId, settings.primary, verse.primary)}
      <div class="verse-language-label secondary-label">${escapeHtml(getLanguage(settings.secondary).label)}</div>
      ${verseButton(verse.verseId, settings.secondary, verse.secondary)}
    </article>`).join("")}</div>`;
  }
  if (settings.layout === "side-by-side") {
    return `<div class="side-by-side-reader">
      <div class="side-language-headings"><h3>${escapeHtml(getLanguage(settings.primary).label)}</h3><h3>${escapeHtml(getLanguage(settings.secondary).label)}</h3></div>
      ${chapterVerses.map((verse) => `<article class="side-by-side-verse">
        ${verseButton(verse.verseId, settings.primary, verse.primary)}
        ${verseButton(verse.verseId, settings.secondary, verse.secondary)}
      </article>`).join("")}
    </div>`;
  }
  if (settings.layout === "balanced") {
    return `<div class="balanced-reader">
      ${renderLanguagePane(settings.primary, "primary-pane", "primary")}
      ${renderLanguagePane(settings.secondary, "secondary-pane", "secondary")}
    </div>`;
  }
  return `<div class="parallel-reader">
    ${renderLanguagePane(settings.primary, "primary-pane", "primary")}
    ${renderLanguagePane(settings.secondary, "secondary-pane", "secondary")}
  </div>`;
}

function renderLanguagePane(languageId, paneClass, verseField) {
  return `<section class="parallel-pane ${paneClass}" aria-label="${escapeHtml(getLanguage(languageId).label)}">
    <h3>${escapeHtml(getLanguage(languageId).label)}</h3>
    <div class="parallel-verses">${chapterVerses.map((verse) => verseButton(verse.verseId, languageId, verse[verseField])).join("")}</div>
  </section>`;
}

function renderSettings() {
  return `<main class="page narrow-page settings-page">
    <div class="page-topline"><button class="back-button" type="button" data-action="back">← Back</button><span class="eyebrow">Personalize reading</span></div>
    <h1>Settings</h1>
    <section class="settings-group">
      <h2>Languages</h2>
      ${renderSelect("primary", "Primary language", LANGUAGES.map(({ id, label }) => [id, label]))}
      ${renderCheckbox("secondaryEnabled", "Show second view")}
      ${settings.secondaryEnabled ? `
        ${renderSelect("secondary", "Second language", LANGUAGES.map(({ id, label }) => [id, label]))}
        ${renderSelect("layout", "Display layout", LAYOUTS.map(({ id, label }) => [id, label]))}
        <p class="setting-note">Balanced split gives both languages equal space, stacked in portrait and side by side in landscape. Other layouts remain available here.</p>
      ` : ""}
    </section>
    <section class="settings-group">
      <h2>Appearance</h2>
      ${renderSelect("zoom", "Reading text zoom", ZOOM_OPTIONS)}
      ${renderCheckbox("readingBold", "Bold reading text")}
      <p class="setting-note">Reading text preview</p>
      <p class="font-preview" aria-label="Reading text size preview">Aa · அ ஆ இ ஈ · അ ആ ഇ ഈ</p>
      <p class="setting-note">At large zoom, side-by-side text may scroll horizontally on narrow screens.</p>
      ${renderSelect("theme", "Theme", THEMES)}
      ${renderSelect("rendering", "Unicode rendering", RENDERING_OPTIONS)}
      <p class="setting-note">Unicode rendering fixes were for older Android versions. Modern browsers use native Unicode rendering.</p>
    </section>
    <section class="settings-group">
      <h2>Bookmarks</h2>
      ${renderCheckbox("groupBookmarks", "Group bookmarks by date")}
      ${renderCheckbox("bookmarkOnLongPress", "Bookmark verses on long press")}
    </section>
    <div class="settings-footer"><button class="secondary-button" type="button" data-action="reset-settings">Restore default settings</button></div>
  </main>`;
}

function renderSelect(key, label, options) {
  const value = String(settings[key]);
  return `<label class="setting-row"><span>${label}</span><select data-setting="${key}">
    ${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${value === String(optionValue) ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}
  </select></label>`;
}

function renderCheckbox(key, label) {
  return `<label class="setting-check"><span>${label}</span><input type="checkbox" data-setting="${key}" ${settings[key] ? "checked" : ""}></label>`;
}

function renderBookmarks() {
  const bookmarks = readBookmarks().sort((first, second) => second.createdAt - first.createdAt);
  let list;
  if (!bookmarks.length) {
    list = `<div class="empty-card"><span class="empty-icon">☆</span><h2>No bookmarks yet</h2><p>Bookmark a chapter or selected verses while reading.</p><button class="primary-button" type="button" data-action="home">Browse books</button></div>`;
  } else if (settings.groupBookmarks) {
    const groups = new Map();
    for (const bookmark of bookmarks) {
      const key = bookmarkDateGroup(bookmark.createdAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(bookmark);
    }
    list = [...groups].map(([groupName, groupBookmarks]) => `<section class="bookmark-group"><h2>${escapeHtml(groupName)}</h2>${groupBookmarks.map(renderBookmark).join("")}</section>`).join("");
  } else {
    list = `<section class="bookmark-list">${bookmarks.map(renderBookmark).join("")}</section>`;
  }
  return `<main class="page narrow-page">
    <div class="page-topline"><button class="back-button" type="button" data-action="back">← Back</button><span class="eyebrow">Your saved passages</span></div>
    <div class="section-heading"><h1>Bookmarks</h1><button class="quiet-button" type="button" data-action="settings">Settings</button></div>
    <div class="bookmark-transfer">
      <button class="secondary-button" type="button" data-action="import-bookmarks">Import bookmarks</button>
      <button class="secondary-button" type="button" data-action="export-bookmarks">Export bookmarks</button>
      <input id="bookmark-import" type="file" accept=".json,application/json" hidden>
    </div>
    ${list}
  </main>`;
}

function renderBookmark(bookmark) {
  const book = bookById(bookmark.bookId);
  const verseRange = bookmark.verseIds?.length ? ` · verses ${formatVerseRanges(bookmark.verseIds)}` : "";
  const title = bookmark.title || `${bookName(book, settings.primary)} ${bookmark.chapterId}${verseRange}`;
  const date = new Date(bookmark.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `<article class="bookmark-card">
    <button class="bookmark-open" type="button" data-action="open-bookmark" data-bookmark-id="${escapeHtml(bookmark.id)}">
      <strong>${escapeHtml(title)}</strong><span>${book ? escapeHtml(bookName(book, settings.secondaryEnabled ? settings.secondary : settings.primary)) : ""} · ${escapeHtml(date)}</span>
    </button>
    <button class="icon-button delete-bookmark" type="button" data-action="delete-bookmark" data-bookmark-id="${escapeHtml(bookmark.id)}" aria-label="Delete bookmark" title="Delete bookmark">×</button>
  </article>`;
}

function renderInfo() {
  return `<main class="page narrow-page info-page">
    <div class="page-topline"><button class="back-button" type="button" data-action="back">← Back</button><span class="eyebrow">About this reader</span></div>
    <h1>Bible</h1>
    <p class="lead">A private, offline-first reading app with Malayalam, Tamil, and English KJV texts.</p>
    <section class="settings-group">
      <h2>Included texts</h2>
      <ul class="text-list"><li>Malayalam: Free Bibles India, adapted to KJV references (CC BY-SA 4.0)</li><li>Tamil: Bible-tamil by Arul John (MIT License)</li><li>English: King James Version (KJV)</li></ul>
      <p class="setting-note">Malayalam original work available at http://www.freebiblesindia.in. Verse boundaries have been adapted; some passages are combined or unavailable, and translation wording can differ from KJV. See MALAYALAM-LICENSE.txt for attribution and license details.</p>
      <p class="setting-note">Verse numbers match KJV, but the translations have not been comprehensively checked for equivalent wording. The original app describes the English content as public domain; confirm its terms before redistribution.</p>
      <p class="setting-note">Tamil text is adapted from Arul John's Bible-tamil repository. Its MIT license and attribution are included in TAMIL-LICENSE.txt.</p>
    </section>
    <section class="settings-group">
      <h2>Offline by design</h2>
      <p>The Android app works completely offline. The web reader can work offline after its first visit has finished loading, when offline caching is available. The reader does not collect or send telemetry.</p>
    </section>
    <section class="settings-group">
      <h2>Support this app</h2>
      <p>This app is completely ad-free and fully functional. If you find it useful, please consider donating to help cover server costs. Thank you for your support!</p>
      <a class="donation-link" href="https://buymeacoffee.com/sj84" ${Capacitor.isNativePlatform() ? "" : 'target="_blank" rel="noopener noreferrer"'}><img src="${import.meta.env.BASE_URL}buy-me-a-coffee.png" alt="Buy Me a Coffee" width="220" height="62"></a>
      <p class="setting-note">The external donation website opens in your browser, requires internet access, and has its own privacy practices.</p>
    </section>
  </main>`;
}

function canGoPrevious() {
  if (!currentBook) return false;
  return currentChapter > 1 || Number(currentBook.book_id) > 1;
}

function canGoNext() {
  if (!currentBook) return false;
  return currentChapter < currentBook.num_chptr || Number(currentBook.book_id) < books.length;
}

function goPrevious() {
  if (!canGoPrevious()) return;
  if (currentChapter > 1) {
    loadChapter(currentBook, currentChapter - 1);
    return;
  }
  const previousBook = bookById(Number(currentBook.book_id) - 1);
  loadChapter(previousBook, previousBook.num_chptr);
}

function goNext() {
  if (!canGoNext()) return;
  if (currentChapter < currentBook.num_chptr) {
    loadChapter(currentBook, currentChapter + 1);
    return;
  }
  loadChapter(bookById(Number(currentBook.book_id) + 1), 1);
}

function bookmarkVerses(verseIds) {
  const ids = [...new Set(verseIds.map(Number))].filter((id) => chapterVerses.some((verse) => verse.verseId === id));
  if (!ids.length) {
    notify("Select at least one verse to bookmark.");
    return;
  }
  const bookmark = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bookId: Number(currentBook.book_id),
    chapterId: currentChapter,
    verseIds: ids.sort((first, second) => first - second),
    createdAt: Date.now(),
    title: `${bookName(currentBook, settings.primary)} ${currentChapter}:${formatVerseRanges(ids)}`,
  };
  if (writeBookmarks([...readBookmarks(), bookmark])) {
    selectedVerses.clear();
    renderReaderPreservingScroll();
    notify("Verses bookmarked.");
  }
}

function bookmarkChapter() {
  const bookmark = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bookId: Number(currentBook.book_id),
    chapterId: currentChapter,
    verseIds: null,
    createdAt: Date.now(),
    title: `${bookName(currentBook, settings.primary)} ${currentChapter}`,
  };
  if (writeBookmarks([...readBookmarks(), bookmark])) notify("Chapter bookmarked.");
}

function selectedText() {
  const ids = [...selectedVerses].sort((first, second) => first - second);
  return ids.map((verseId) => {
    const verse = chapterVerses.find((item) => item.verseId === verseId);
    if (!verse) return "";
    const reference = `${bookName(currentBook, settings.primary)} ${currentChapter}:${verseId}`;
    const primary = `${getLanguage(settings.primary).label}: ${verse.primary}`;
    const secondary = !settings.secondaryEnabled
      ? ""
      : `\n${getLanguage(settings.secondary).label}: ${verse.secondary}`;
    return `${reference}\n${primary}${secondary}`;
  }).filter(Boolean).join("\n\n");
}

async function copySelection() {
  const text = selectedText();
  if (!text) {
    notify("Select one or more verses first.");
    return;
  }
  if (!navigator.clipboard?.writeText) {
    notify("Clipboard access is not available in this browser.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    notify("Selected verses copied.");
  } catch (error) {
    notify(`Could not copy verses: ${error.message}`);
  }
}

async function shareSelection() {
  const text = selectedText();
  if (!text) {
    notify("Select one or more verses first.");
    return;
  }
  if (!navigator.share) {
    await copySelection();
    notify("Sharing is unavailable here; verses were copied instead.");
    return;
  }
  try {
    await navigator.share({ title: "Bible verses", text });
  } catch (error) {
    if (error.name !== "AbortError") notify(`Could not share verses: ${error.message}`);
  }
}

function renderReaderPreservingScroll() {
  const selector = ".reader-content, .parallel-pane, .side-by-side-reader";
  const scrollPositions = [...app.querySelectorAll(selector)].map((element) => ({
    top: element.scrollTop,
    left: element.scrollLeft,
  }));
  render();
  app.querySelectorAll(selector).forEach((element, index) => {
    element.scrollTop = scrollPositions[index].top;
    element.scrollLeft = scrollPositions[index].left;
  });
}

function toggleVerse(verseId) {
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  if (selectedVerses.has(verseId)) selectedVerses.delete(verseId);
  else selectedVerses.add(verseId);
  renderReaderPreservingScroll();
}

function connectParallelScroll() {
  const panes = [...app.querySelectorAll(".parallel-pane")];
  if (panes.length !== 2) return;
  const rows = panes.map((pane) => [...pane.querySelectorAll(".verse-text")]);
  function alignVerses() {
    if (!panes[0].isConnected || !panes[0].clientWidth || !panes[1].clientWidth) return;
    const scrollPositions = panes.map((pane) => pane.scrollTop);
    for (const verses of rows) {
      for (const verse of verses) verse.style.minHeight = "";
    }
    const heights = rows[0].map((verse, index) =>
      Math.max(verse.getBoundingClientRect().height, rows[1][index].getBoundingClientRect().height));
    for (const verses of rows) {
      verses.forEach((verse, index) => { verse.style.minHeight = `${heights[index]}px`; });
    }
    panes.forEach((pane, index) => { pane.scrollTop = scrollPositions[index]; });
  }
  alignVerses();
  parallelResizeObserver = new ResizeObserver(alignVerses);
  panes.forEach((pane) => parallelResizeObserver.observe(pane));
  document.fonts.ready.then(alignVerses);
  for (const pane of panes) {
    pane.addEventListener("scroll", () => {
      if (parallelScrollLock) return;
      const other = panes.find((candidate) => candidate !== pane);
      const max = pane.scrollHeight - pane.clientHeight;
      const otherMax = other.scrollHeight - other.clientHeight;
      if (max <= 0 || otherMax <= 0) return;
      parallelScrollLock = true;
      other.scrollTop = pane.scrollTop;
      requestAnimationFrame(() => { parallelScrollLock = false; });
    }, { passive: true });
  }
}

function handlePointerDown(event) {
  const verse = event.target.closest(".verse-text[data-verse-id]");
  if (!verse || !settings.bookmarkOnLongPress) return;
  window.clearTimeout(longPressTimer);
  longPressTriggered = false;
  const verseId = Number(verse.dataset.verseId);
  longPressTimer = window.setTimeout(() => {
    longPressTriggered = true;
    bookmarkVerses([verseId]);
  }, 650);
}

function clearLongPress() {
  window.clearTimeout(longPressTimer);
}

function handleContextMenu(event) {
  if (event.target.closest(".verse-text[data-verse-id]")) event.preventDefault();
}

function openBookmark(bookmarkId) {
  const bookmark = readBookmarks().find((item) => item.id === bookmarkId);
  if (!bookmark) {
    notify("That bookmark is no longer available.");
    return;
  }
  const book = bookById(bookmark.bookId);
  if (!book) {
    notify("The bookmarked book is not available.");
    return;
  }
  loadChapter(book, Number(bookmark.chapterId), bookmark.verseIds || []);
}

function handleNativeBack() {
  if (activeView === "reader") {
    activeView = "chapters";
    render();
    return;
  }
  if (activeView === "chapters") {
    activeView = "books";
    render();
    return;
  }
  if (activeView === "books") {
    void App.exitApp();
    return;
  }
  activeView = returnView;
  if (activeView === "reader" && currentBook) {
    loadChapter(currentBook, currentChapter, [...selectedVerses]);
  } else {
    render();
  }
}

function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target || !app.contains(target)) return;
  const action = target.dataset.action;
  switch (action) {
    case "home":
      activeView = "books";
      bookFilter = "";
      render();
      break;
    case "back":
      activeView = returnView;
      if (activeView === "reader" && currentBook) {
        loadChapter(currentBook, currentChapter, [...selectedVerses]);
      } else {
        render();
      }
      break;
    case "settings":
      if (activeView === "settings") break;
      returnView = activeView;
      activeView = "settings";
      render();
      break;
    case "info":
      if (activeView === "info") break;
      returnView = activeView;
      activeView = "info";
      render();
      break;
    case "bookmarks":
      if (activeView === "bookmarks") break;
      returnView = activeView;
      activeView = "bookmarks";
      render();
      break;
    case "open-book":
      currentBook = bookById(target.dataset.bookId);
      activeView = "chapters";
      render();
      break;
    case "open-chapter":
      loadChapter(currentBook, Number(target.dataset.chapterId));
      break;
    case "chapters":
      activeView = "chapters";
      render();
      break;
    case "continue-reading":
      if (lastPosition) loadChapter(bookById(lastPosition.bookId), lastPosition.chapterId);
      break;
    case "previous":
      goPrevious();
      break;
    case "next":
      goNext();
      break;
    case "toggle-verse":
      toggleVerse(Number(target.dataset.verseId));
      break;
    case "bookmark-chapter":
      bookmarkChapter();
      break;
    case "bookmark-selection":
      bookmarkVerses([...selectedVerses]);
      break;
    case "clear-selection":
      selectedVerses.clear();
      renderReaderPreservingScroll();
      break;
    case "copy":
      void copySelection();
      break;
    case "share":
      void shareSelection();
      break;
    case "open-bookmark":
      openBookmark(target.dataset.bookmarkId);
      break;
    case "import-bookmarks":
      app.querySelector("#bookmark-import").click();
      break;
    case "export-bookmarks":
      void exportBookmarks();
      break;
    case "delete-bookmark": {
      const next = readBookmarks().filter((bookmark) => bookmark.id !== target.dataset.bookmarkId);
      if (writeBookmarks(next)) {
        render();
        notify("Bookmark deleted.");
      }
      break;
    }
    case "reset-settings":
      setSettings({ ...DEFAULT_SETTINGS });
      notify("Default settings restored.");
      break;
    default:
      break;
  }
}

function handleChange(event) {
  if (event.target.id === "bookmark-import") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importBookmarks(file);
    return;
  }
  const setting = event.target.dataset.setting;
  if (setting) {
    const value = event.target.type === "checkbox" ? event.target.checked
      : setting === "zoom" ? Number(event.target.value) : event.target.value;
    setSettings({ [setting]: value });
    return;
  }
  if (event.target.dataset.select === "chapter" && currentBook) {
    loadChapter(currentBook, Number(event.target.value));
  }
}

function handleInput(event) {
  if (event.target.id !== "book-search") return;
  const input = event.target;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  bookFilter = input.value;
  const replacement = document.createElement("div");
  replacement.innerHTML = renderBooks();
  app.querySelector(".page").replaceWith(replacement.firstElementChild);
  const nextInput = app.querySelector("#book-search");
  nextInput?.focus();
  nextInput?.setSelectionRange(start, end);
}

function bookmarkDateGroup(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (day === today) return "Today";
  if (day === today - 86400000) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

async function initialize() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const response = await fetch(`${import.meta.env.BASE_URL}data/bible.sqlite`);
  if (!response.ok) throw new Error(`Could not load the bundled Bible database (${response.status}).`);
  const database = new Uint8Array(await response.arrayBuffer());
  db = new SQL.Database(database);
  books = queryBooks();
  if (books.length !== 66) throw new Error(`Expected 66 Bible books; found ${books.length}.`);
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_POSITION_KEY) || "null");
    if (saved && bookById(saved.bookId) && Number.isInteger(Number(saved.chapterId))) {
      lastPosition = { bookId: Number(saved.bookId), chapterId: Number(saved.chapterId) };
    }
  } catch (error) {
    notify(`Could not restore reading position: ${error.message}`);
  }
  render();
  if (Capacitor.isNativePlatform()) {
    await App.addListener("backButton", handleNativeBack);
  }
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) => notify(`Offline cache could not be installed: ${error.message}`));
  }
}

initialize().catch((error) => {
  app.innerHTML = `<main class="fatal-error"><div class="error-mark">!</div><h1>Bible library unavailable</h1><p>${escapeHtml(error.message)}</p><p>Run the database import step described in the project README, then build the app again.</p></main>`;
  console.error(error);
});
