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

export function presentationSlide(verses, start, heights, availableHeight, endHeight) {
  const first = verses.findIndex((verse) => verse.id >= start);
  if (first < 0) return [];
  let height = 0;
  const slide = [];
  for (let index = first; index < verses.length; index += 1) {
    const required = height + heights[index] + (index === verses.length - 1 ? endHeight : 0);
    if (required > availableHeight) break;
    slide.push(verses[index]);
    height += heights[index];
  }
  return slide;
}

export function nextPresentationStart(current, direction, last) {
  return Math.max(1, Math.min(last, current + direction * 2));
}

export function presentationSwipeDirection(deltaX, deltaY) {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 40) return 0;
  const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
  return delta < 0 ? 1 : -1;
}
