import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  buildVersePairs,
  formatVerseRanges,
  getLanguage,
  getTranslationTable,
  LANGUAGES,
  LAYOUTS,
} from "./catalog.js";
import { DEFAULT_ZOOM, readZoom, ZOOM_OPTIONS } from "./zoom.js";
import "./style.css";

const app = document.querySelector("#app");
const SETTINGS_KEY = "bible-reader.settings";
const BOOKMARKS_KEY = "bible-reader.bookmarks";
const LAST_POSITION_KEY = "bible-reader.last-position";
const APP_ICON_URL = `${import.meta.env.BASE_URL}icon-192.png`;
const DEFAULT_SETTINGS = Object.freeze({
  primary: "ml",
  secondary: "kjv",
  layout: "balanced",
  zoom: DEFAULT_ZOOM,
  theme: "green",
  rendering: "0",
  groupBookmarks: false,
  bookmarkOnLongPress: true,
});
const THEMES = [
  ["white", "White"],
  ["black", "Black"],
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
let lastPosition;
let settings = readSettings();

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const next = { ...DEFAULT_SETTINGS, ...stored, zoom: readZoom(stored) };
    delete next.fontSize;
    if (!LANGUAGES.some((language) => language.id === next.primary)) next.primary = DEFAULT_SETTINGS.primary;
    if (next.secondary !== "none" && !LANGUAGES.some((language) => language.id === next.secondary)) {
      next.secondary = DEFAULT_SETTINGS.secondary;
    }
    if (!LAYOUTS.some((layout) => layout.id === next.layout)) next.layout = DEFAULT_SETTINGS.layout;
    if (!THEMES.some(([theme]) => theme === next.theme)) next.theme = DEFAULT_SETTINGS.theme;
    if (!RENDERING_OPTIONS.some(([mode]) => mode === String(next.rendering))) next.rendering = DEFAULT_SETTINGS.rendering;
    next.rendering = String(next.rendering);
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
  return languageId === "ml" ? book.MalayalamShortName : book.EnglishShortName;
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

function loadChapter(book, chapterId, verseIds = null) {
  if (!book || chapterId < 1 || chapterId > Number(book.num_chptr)) {
    notify("That chapter is not available.");
    return;
  }
  const nextChapter = Number(chapterId);
  try {
    const primary = getVerses(settings.primary, book.book_id, nextChapter);
    const secondary = settings.secondary === "none"
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
    "SELECT book_id, EnglishShortName, MalayalamShortName, num_chptr FROM books ORDER BY book_id",
  );
  if (!result[0]?.values) throw new Error("The Bible database does not contain its book list.");
  return result[0].values.map(([book_id, EnglishShortName, MalayalamShortName, num_chptr]) => ({
    book_id: Number(book_id),
    EnglishShortName,
    MalayalamShortName,
    num_chptr: Number(num_chptr),
  }));
}

function renderHeader() {
  return `<header class="app-header">
    <button class="brand" type="button" data-action="home" aria-label="Go to books">
      <img class="brand-mark" src="${APP_ICON_URL}" alt="">
      <span><strong>Malayalam Bible</strong><small>Offline reader</small></span>
    </button>
    <nav class="header-actions" aria-label="App">
      <button class="quiet-button" type="button" data-action="bookmarks">Bookmarks</button>
      <button class="quiet-button" type="button" data-action="settings">Settings</button>
      <button class="icon-button" type="button" data-action="info" aria-label="Information" title="Information">ⓘ</button>
    </nav>
  </header>`;
}

function render() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.view = activeView;
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
  if (activeView === "reader" && settings.secondary !== "none" && ["balanced", "parallel"].includes(settings.layout)) {
    connectParallelScroll();
  }
}

function renderBooks() {
  const normalizedFilter = bookFilter.trim().toLocaleLowerCase();
  const visibleBooks = books.filter((book) => {
    const names = `${book.EnglishShortName} ${book.MalayalamShortName}`.toLocaleLowerCase();
    return names.includes(normalizedFilter);
  });
  const oldTestament = visibleBooks.filter((book) => book.book_id <= 39);
  const newTestament = visibleBooks.filter((book) => book.book_id > 39);
  const continueBook = lastPosition ? bookById(lastPosition.bookId) : null;
  return `<main class="page">
    <section class="welcome-card">
      <div>
        <p class="eyebrow">A quiet place to read</p>
        <h1>Read in Malayalam and English.</h1>
        <p>All 66 books are included for offline reading. Choose a book to begin.</p>
      </div>
      <span class="welcome-symbol" aria-hidden="true">ബൈബിൾ</span>
    </section>
    ${continueBook ? `<button class="continue-card" type="button" data-action="continue-reading">
      <span><small>Continue reading</small><strong>${escapeHtml(bookName(continueBook, settings.primary))} ${lastPosition.chapterId}</strong></span>
      <span class="continue-arrow" aria-hidden="true">→</span>
    </button>` : ""}
    <div class="section-heading book-heading">
      <div><p class="eyebrow">The library</p><h2>Books of the Bible</h2></div>
      <label class="search-box"><span class="sr-only">Search books</span><input id="book-search" type="search" value="${escapeHtml(bookFilter)}" placeholder="Find a book" autocomplete="off"></label>
    </div>
    ${renderBookSection("Old Testament", oldTestament)}
    ${renderBookSection("New Testament", newTestament)}
    ${visibleBooks.length === 0 ? `<p class="empty-state">No books match that search.</p>` : ""}
  </main>`;
}

function renderBookSection(title, sectionBooks) {
  if (!sectionBooks.length) return "";
  return `<section class="book-section"><h3>${title}</h3><div class="book-grid">
    ${sectionBooks.map((book) => `<button class="book-card" type="button" data-action="open-book" data-book-id="${book.book_id}">
      <span class="book-card-top"><strong>${escapeHtml(bookName(book, settings.primary))}</strong><span aria-hidden="true">›</span></span>
      ${settings.secondary === "none" ? "" : `<small>${escapeHtml(bookName(book, settings.secondary))}</small>`}
      <small>${book.num_chptr} chapters</small>
    </button>`).join("")}
  </div></section>`;
}

function renderChapters() {
  if (!currentBook) return renderBooks();
  const primaryName = bookName(currentBook, settings.primary);
  const secondaryName = settings.secondary === "none" ? "" : bookName(currentBook, settings.secondary);
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
  const balanced = settings.secondary !== "none" && settings.layout === "balanced";
  const readerContent = renderReaderContent();
  return `<main class="reader-page ${balanced ? "is-balanced-reader" : ""}">
    <header class="reader-toolbar">
      <button class="reader-back icon-button" type="button" data-action="chapters" aria-label="Choose a chapter" title="Choose a chapter">‹</button>
      <div class="reader-location">
        <strong>${escapeHtml(bookName(currentBook, settings.primary))}</strong>
        <span>${escapeHtml(getLanguage(settings.primary).label)}${settings.secondary === "none" ? "" : ` · ${escapeHtml(getLanguage(settings.secondary).label)}`}</span>
      </div>
      <label class="chapter-picker"><span class="sr-only">Choose chapter</span><select data-select="chapter" aria-label="Choose chapter">${chapterOptions}</select></label>
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
  return `<button type="button" class="verse-text ${selected ? "is-selected" : ""}" data-action="toggle-verse" data-verse-id="${verseId}" aria-pressed="${selected}" lang="${languageId === "ml" ? "ml" : "en"}">
    <span class="verse-number">${verseId}</span><span>${escapeHtml(text)}</span>
  </button>`;
}

function renderReaderContent() {
  if (settings.secondary === "none") {
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
      ${renderLanguagePane(settings.primary, "primary-pane")}
      ${renderLanguagePane(settings.secondary, "secondary-pane")}
    </div>`;
  }
  return `<div class="parallel-reader">
    ${renderLanguagePane(settings.primary, "primary-pane")}
    ${renderLanguagePane(settings.secondary, "secondary-pane")}
  </div>`;
}

function renderLanguagePane(languageId, paneClass) {
  return `<section class="parallel-pane ${paneClass}" aria-label="${escapeHtml(getLanguage(languageId).label)}">
    <h3>${escapeHtml(getLanguage(languageId).label)}</h3>
    <div class="parallel-verses">${chapterVerses.map((verse) => verseButton(verse.verseId, languageId, verse[languageId === settings.primary ? "primary" : "secondary"])).join("")}</div>
  </section>`;
}

function renderSettings() {
  return `<main class="page narrow-page settings-page">
    <div class="page-topline"><button class="back-button" type="button" data-action="back">← Back</button><span class="eyebrow">Personalize reading</span></div>
    <h1>Settings</h1>
    <section class="settings-group">
      <h2>Languages</h2>
      ${renderSelect("primary", "Primary language", LANGUAGES.map(({ id, label }) => [id, label]))}
      ${renderSelect("secondary", "Second language", [["none", "None"], ...LANGUAGES.map(({ id, label }) => [id, label])])}
      ${renderSelect("layout", "Display layout", LAYOUTS.map(({ id, label }) => [id, label]))}
      <p class="setting-note">Balanced split gives both languages equal space, stacked in portrait and side by side in landscape. Other layouts remain available here.</p>
    </section>
    <section class="settings-group">
      <h2>Appearance</h2>
      ${renderSelect("zoom", "Reading text zoom", ZOOM_OPTIONS)}
      <p class="setting-note">Reading text preview</p>
      <p class="font-preview" aria-label="Reading text size preview">Aa · അ ആ ഇ ഈ</p>
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
      <strong>${escapeHtml(title)}</strong><span>${book ? escapeHtml(bookName(book, settings.secondary === "none" ? settings.primary : settings.secondary)) : ""} · ${escapeHtml(date)}</span>
    </button>
    <button class="icon-button delete-bookmark" type="button" data-action="delete-bookmark" data-bookmark-id="${escapeHtml(bookmark.id)}" aria-label="Delete bookmark" title="Delete bookmark">×</button>
  </article>`;
}

function renderInfo() {
  return `<main class="page narrow-page info-page">
    <div class="page-topline"><button class="back-button" type="button" data-action="back">← Back</button><span class="eyebrow">About this reader</span></div>
    <h1>Malayalam Bible Reader</h1>
    <p class="lead">A private, offline-first reading app with Malayalam and English KJV and ASV texts.</p>
    <section class="settings-group">
      <h2>Included texts</h2>
      <ul class="text-list"><li>Malayalam: The Complete Malayalam Bible In Unicode, Ver. 3</li><li>English: King James Version (KJV)</li><li>English: American Standard Version (ASV)</li></ul>
      <p class="setting-note">The original app's information page credits the Malayalam encoding to Nishad Kaippally and describes non-commercial, non-profit use under a Creative Commons license; it does not identify a license version. The original app describes the English content as public domain. This recreation is intended for private use; confirm current terms before sharing or redistributing text.</p>
      <p class="setting-note">App behavior and text content are recreated from the local decompiled source supplied for this project. The original name and branding are not reused; the app icon was supplied for this recreation.</p>
    </section>
    <section class="settings-group">
      <h2>Offline by design</h2>
      <p>The Bible database is bundled with the app. Reading, navigation, settings, and bookmarks work without an internet connection.</p>
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
    render();
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
    const secondary = settings.secondary === "none"
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

function toggleVerse(verseId) {
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  const scrollPositions = [...app.querySelectorAll(".parallel-pane")].map((pane) => pane.scrollTop);
  if (selectedVerses.has(verseId)) selectedVerses.delete(verseId);
  else selectedVerses.add(verseId);
  render();
  app.querySelectorAll(".parallel-pane").forEach((pane, index) => {
    pane.scrollTop = scrollPositions[index] || 0;
  });
}

function connectParallelScroll() {
  const panes = [...app.querySelectorAll(".parallel-pane")];
  for (const pane of panes) {
    pane.addEventListener("scroll", () => {
      if (parallelScrollLock || panes.length !== 2) return;
      const other = panes.find((candidate) => candidate !== pane);
      const max = pane.scrollHeight - pane.clientHeight;
      const otherMax = other.scrollHeight - other.clientHeight;
      if (max <= 0 || otherMax <= 0) return;
      parallelScrollLock = true;
      other.scrollTop = (pane.scrollTop / max) * otherMax;
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
      render();
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
