export const LANGUAGES = Object.freeze([
  { id: "ta", label: "Tamil", bookName: "TamilShortName", bibleName: "பைபிள்", table: "verses_tamil" },
  { id: "ml", label: "Malayalam", bookName: "MalayalamShortName", bibleName: "ബൈബിൾ", table: "verses" },
  { id: "hi", label: "Hindi", bookName: "HindiShortName", bibleName: "बाइबिल", table: "verses_hindi" },
  { id: "kjv", label: "English - KJV", bookName: "EnglishShortName", bibleName: "Bible", table: "verses_kjv" },
]);

export const DEFAULT_PRIMARY_LANGUAGE = "ta";
export const DEFAULT_SECONDARY_LANGUAGE = "ml";

export const LAYOUTS = Object.freeze([
  { id: "verse", label: "Verse by verse" },
  { id: "balanced", label: "Balanced split" },
  { id: "parallel", label: "Parallel" },
  { id: "side-by-side", label: "Side by side" },
]);

const LANGUAGE_BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]));

export function readSecondView(stored) {
  return {
    secondaryEnabled: typeof stored.secondaryEnabled === "boolean"
      ? stored.secondaryEnabled : stored.secondary !== "none",
    secondary: LANGUAGES.some((language) => language.id === stored.secondary) ? stored.secondary : DEFAULT_SECONDARY_LANGUAGE,
  };
}

export function getLanguage(languageId) {
  return LANGUAGE_BY_ID.get(languageId) ?? LANGUAGE_BY_ID.get("ml");
}

export function getTranslationTable(languageId) {
  return getLanguage(languageId).table;
}

export function buildVersePairs(primaryVerses, secondaryVerses) {
  const pairs = new Map();
  for (const verse of primaryVerses) {
    pairs.set(Number(verse.verse_id), { verseId: Number(verse.verse_id), primary: verse.verse_text, secondary: "" });
  }
  for (const verse of secondaryVerses) {
    const verseId = Number(verse.verse_id);
    const pair = pairs.get(verseId) ?? { verseId, primary: "", secondary: "" };
    pair.secondary = verse.verse_text;
    pairs.set(verseId, pair);
  }
  return [...pairs.values()].sort((first, second) => first.verseId - second.verseId);
}

export function formatVerseRanges(verseIds) {
  const sorted = [...new Set(verseIds.map(Number))]
    .filter((verseId) => Number.isInteger(verseId) && verseId > 0)
    .sort((first, second) => first - second);
  const ranges = [];
  for (const verseId of sorted) {
    const lastRange = ranges.at(-1);
    if (lastRange && verseId === lastRange[1] + 1) {
      lastRange[1] = verseId;
    } else {
      ranges.push([verseId, verseId]);
    }
  }
  return ranges.map(([start, end]) => start === end ? `${start}` : `${start}-${end}`).join(",");
}
