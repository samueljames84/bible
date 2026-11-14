export function availablePresentationVerses(verses) {
  return verses
    .map(({ verse_id, verse_text }) => ({ id: Number(verse_id), text: String(verse_text ?? "").trim() }))
    .filter(({ id, text }) => Number.isInteger(id) && id > 0 && text
      && !/^\[(?:Malayalam verse unavailable|Combined with Malayalam verse)\b[^\]]*\]$/i.test(text))
    .sort((a, b) => a.id - b.id);
}

export function lastPresentationStart(verses) {
  return verses.length ? Math.floor((verses.at(-1).id - 1) / 2) * 2 + 1 : 0;
}

export function presentationSlide(verses, start) {
  return verses.filter((verse) => verse.id >= start).slice(0, 4);
}

export function nextPresentationStart(current, direction, last) {
  return Math.max(1, Math.min(last, current + direction * 2));
}
