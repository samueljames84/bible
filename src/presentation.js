import { Capacitor } from "@capacitor/core";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { LANGUAGES } from "./catalog.js";
import {
  availablePresentationVerses,
  lastPresentationStart,
  nextPresentationStart,
  presentationSlide,
} from "./presentation-logic.js";
import "./presentation.css";

const root = document.querySelector("#presentation");
const SLIDE_DURATION_MS = 300;

function readRows(db, sql, parameters) {
  const statement = db.prepare(sql);
  const rows = [];
  try {
    statement.bind(parameters);
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function positiveNumber(value) {
  return /^\d+$/.test(value ?? "") && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value) : null;
}

function verseElement(verse) {
  const row = document.createElement("div");
  row.className = "presentation-verse";
  row.dataset.verseId = String(verse.id);
  const number = document.createElement("span");
  number.className = "presentation-number";
  number.textContent = verse.id;
  const text = document.createElement("span");
  text.textContent = verse.text;
  row.append(number, text);
  return row;
}

function startPresentation(title, languageId, verses, chapterTotal) {
  const header = document.createElement("header");
  header.className = "presentation-header";
  const heading = document.createElement("h1");
  heading.className = "presentation-heading";
  heading.textContent = title;
  const progress = document.createElement("span");
  progress.className = "presentation-progress";
  progress.setAttribute("aria-label", "Verse progress");
  header.append(heading, progress);
  const viewport = document.createElement("section");
  viewport.className = "presentation-viewport";
  viewport.lang = languageId === "kjv" ? "en" : languageId;
  viewport.setAttribute("aria-label", title);
  const measure = document.createElement("div");
  measure.className = "presentation-measure";
  measure.setAttribute("aria-hidden", "true");
  const measurements = verses.map(verseElement);
  const endMeasurement = document.createElement("div");
  endMeasurement.className = "presentation-end";
  endMeasurement.textContent = "-END-";
  measure.append(...measurements, endMeasurement);
  const clip = document.createElement("div");
  clip.className = "presentation-clip";
  const panel = document.createElement("div");
  panel.className = "presentation-panel";
  panel.style.setProperty("--slide-duration", `${SLIDE_DURATION_MS}ms`);
  const rows = verses.map(verseElement);
  const end = document.createElement("div");
  end.className = "presentation-end";
  end.textContent = "-END-";
  panel.append(...rows, end);
  clip.append(panel);
  viewport.append(measure, clip);
  root.replaceChildren(header, viewport);
  document.title = `${title} - Bible Presentation`;

  const last = lastPresentationStart(verses);
  let current = 1;
  let target = 1;
  let animating = false;
  let animationTimer;
  let generation = 0;
  let resizeFrame;

  function showSlide(start) {
    const first = verses.findIndex((verse) => verse.id >= start);
    const heights = rows.map((row) => row.getBoundingClientRect().height);
    const endHeight = end.getBoundingClientRect().height;
    const slide = presentationSlide(verses, start, heights, viewport.clientHeight - 1, endHeight);
    const offset = rows[first].getBoundingClientRect().top - panel.getBoundingClientRect().top;
    const showsEnd = slide.at(-1)?.id === verses.at(-1).id;
    const slideHeight = heights.slice(first, first + slide.length).reduce((sum, height) => sum + height, 0)
      + (showsEnd ? endHeight : 0);
    clip.style.height = `${slideHeight}px`;
    panel.dataset.start = String(start);
    progress.textContent = `${verses[first].id} / ${chapterTotal}`;
    rows.forEach((row, index) => {
      row.setAttribute("aria-hidden", index < first || index >= first + slide.length ? "true" : "false");
    });
    end.setAttribute("aria-hidden", showsEnd ? "false" : "true");
    panel.style.transform = `translateY(${-offset}px)`;
  }

  function fitText() {
    const availableHeight = viewport.clientHeight;
    if (!availableHeight || !viewport.clientWidth) return;
    function measureAt(size) {
      measure.style.setProperty("--presentation-size", `${size}px`);
      return {
        heights: measurements.map((row) => row.getBoundingClientRect().height),
        endHeight: endMeasurement.getBoundingClientRect().height,
      };
    }
    function largestSize(maximum, fits) {
      let low = 1;
      let high = maximum;
      for (let iteration = 0; iteration < 16; iteration += 1) {
        const size = (low + high) / 2;
        if (fits(measureAt(size))) low = size;
        else high = size;
      }
      return low;
    }
    const heightLimit = availableHeight - 1;
    let size = largestSize(256, ({ heights, endHeight }) =>
      heights.every((height, index) => height + (heights[index + 1] ?? 0) <= heightLimit)
      && heights.at(-1) + (heights.at(-2) ?? 0) + endHeight <= heightLimit);
    viewport.style.setProperty("--presentation-size", `${size}px`);
  }

  function redraw() {
    generation += 1;
    window.clearTimeout(animationTimer);
    animating = false;
    target = current;
    fitText();
    panel.style.transition = "none";
    showSlide(current);
    void panel.offsetHeight;
    panel.style.transition = "";
  }

  function advance() {
    if (animating || current === target) return;
    const direction = target > current ? 1 : -1;
    const next = nextPresentationStart(current, direction, last);
    current = next;
    animating = true;
    const animation = ++generation;
    showSlide(current);
    animationTimer = window.setTimeout(() => {
      if (animation !== generation) return;
      animating = false;
      advance();
    }, SLIDE_DURATION_MS);
  }

  window.addEventListener("keydown", (event) => {
    const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1
      : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    target = nextPresentationStart(target, direction, last);
    advance();
  });
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(redraw);
  });
  redraw();
  document.fonts.ready.then(redraw);
}

async function initialize() {
  if (Capacitor.isNativePlatform()) throw new Error("Presentation mode is available on the website only.");
  const params = new URLSearchParams(window.location.search);
  const bookId = positiveNumber(params.get("book"));
  const chapterId = positiveNumber(params.get("chapter"));
  const language = LANGUAGES.find((item) => item.id === params.get("language"));
  if (!bookId || !chapterId || !language) throw new Error("The presentation chapter or language is invalid.");

  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const response = await fetch(`${import.meta.env.BASE_URL}data/bible.sqlite`);
  if (!response.ok) throw new Error(`Could not load the Bible database (${response.status}).`);
  const db = new SQL.Database(new Uint8Array(await response.arrayBuffer()));
  try {
    const [book] = readRows(db,
      "SELECT books.book_id, num_chptr, EnglishShortName, MalayalamShortName, TamilShortName FROM books JOIN tamil_books ON books.book_id = tamil_books.book_id WHERE books.book_id = ?",
      [bookId]);
    if (!book || chapterId > Number(book.num_chptr)) throw new Error("That chapter is not available.");
    const source = readRows(db,
      `SELECT verse_id, verse_text FROM ${language.table} WHERE book_id = ? AND chapter_id = ? ORDER BY verse_id`,
      [bookId, chapterId]);
    const verses = availablePresentationVerses(source);
    if (!verses.length) throw new Error("No verses are available for this chapter and language.");
    const [total] = readRows(db,
      "SELECT MAX(verse_id) AS verse_count FROM verses_kjv WHERE book_id = ? AND chapter_id = ?",
      [bookId, chapterId]);
    const chapterTotal = Number(total?.verse_count);
    if (!Number.isInteger(chapterTotal) || chapterTotal < verses.at(-1).id) {
      throw new Error("The KJV chapter verse count is not available.");
    }
    startPresentation(`${book[language.bookName]} ${chapterId}`, language.id, verses, chapterTotal);
  } finally {
    db.close();
  }
}

initialize().catch((error) => {
  const message = document.createElement("p");
  message.className = "presentation-status";
  message.setAttribute("role", "alert");
  message.textContent = `Presentation unavailable: ${error.message}`;
  root.replaceChildren(message);
  console.error(error);
});
