import hashlib
import io
import re
import sqlite3
import urllib.request
import zipfile
from pathlib import Path


REVISION = "2f1c62bcd06158a1f5f13cc1fcaa2f8fac1fc2c2"
URL = f"https://codeload.github.com/FreeBiblesIndia/Malayalam_Bible/zip/{REVISION}"
SHA256 = "cfc59461b382ddd5c0b0ac51b82daaee045a9de039933cb3d67ec9508766da01"
DATABASE = Path(__file__).resolve().parents[1] / "public" / "data" / "bible.sqlite"
BOOK_IDS = (
    "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB "
    "PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP "
    "HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH "
    "1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV"
).split()


def parse_source(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = sorted(name for name in archive.namelist() if name.endswith(".usfm"))
        if len(files) != len(BOOK_IDS):
            raise ValueError(f"Expected 66 USFM books, found {len(files)}.")
        verses = {}
        bridges = {}
        chapters = set()
        for book_id, (filename, expected_id) in enumerate(zip(files, BOOK_IDS), 1):
            text = archive.read(filename).decode("utf-8-sig")
            book_match = re.search(r"(?m)^\\id\s+(\S+)", text)
            if not book_match or book_match.group(1) != expected_id:
                raise ValueError(f"Unexpected book in {filename}: expected {expected_id}.")
            text = re.sub(r"\\f\s+.*?\\f\*", "", text, flags=re.DOTALL)
            if re.search(r"\\f(?:\s|\*)", text):
                raise ValueError(f"Unmatched footnote in {filename}.")
            chapter = None
            current = None
            for line in text.splitlines():
                match = re.match(r"^\\c\s+(\d+)\s*$", line)
                if match:
                    chapter = int(match.group(1))
                    if (book_id, chapter) in chapters:
                        raise ValueError(f"Duplicate chapter: {filename} {chapter}.")
                    chapters.add((book_id, chapter))
                    current = None
                    continue
                if chapter is None:
                    continue
                match = re.match(r"^\\v\s+(\d+)(?:-(\d+))?\s+(.+)$", line)
                if match:
                    first = int(match.group(1))
                    last = int(match.group(2) or first)
                    current = (book_id, chapter, first)
                    if current in verses or last < first:
                        raise ValueError(f"Invalid or duplicate verse: {filename} {chapter}:{first}.")
                    verses[current] = match.group(3)
                    if last != first:
                        bridges[current] = last
                    continue
                match = re.match(r"^\\(q[1-4]?|m)(?:\s+(.*))?$", line)
                if match:
                    if match.group(2):
                        if current is None:
                            raise ValueError(f"Text before a verse in {filename} {chapter}.")
                        verses[current] += " " + match.group(2)
                    continue
                if not line.strip() or re.match(r"^\\(?:p|s|d|qa|ms|r)(?:\s|$)", line):
                    continue
                raise ValueError(f"Unexpected USFM line in {filename} {chapter}: {line[:100]!r}")
        for key, text in verses.items():
            text = re.sub(r"\\(?:wj|qs)\*?\s*", "", text)
            if "\\" in text:
                raise ValueError(f"Unrecognized inline marker at {key}.")
            verses[key] = re.sub(r"\s+", " ", text).strip()
            if not verses[key]:
                raise ValueError(f"Empty source verse at {key}.")
        return verses, bridges, chapters


def split_at(text, marker):
    if text.count(marker) != 1:
        raise ValueError(f"Expected exactly one occurrence of split marker {marker!r}.")
    left, right = text.split(marker)
    if not left.strip() or not right.strip():
        raise ValueError(f"Invalid split at {marker!r}.")
    return left.strip(), (marker.strip() + right).strip()


def align_verses(verses, bridges):
    verses = verses.copy()
    expected_bridges = {
        (2, 7, 24): 25, (5, 12, 31): 32, (5, 29, 28): 29,
        (9, 30, 30): 31, (10, 17, 28): 29, (22, 6, 12): 13,
        (44, 15, 28): 29, (44, 15, 34): 35, (44, 28, 28): 29,
        (45, 16, 24): 25,
    }
    if bridges != expected_bridges:
        raise ValueError(f"Unexpected source verse bridges: {bridges!r}")

    verses[(1, 1, 5)] += " [The source repeats part of this verse.]"
    verses[(2, 7, 25)], verses[(2, 8, 1)] = split_at(verses[(2, 8, 1)], " മോശെയോട്")
    verses[(5, 12, 32)] = verses.pop((5, 13, 1))
    for number in range(2, 18):
        verses[(5, 13, number - 1)] = verses.pop((5, 13, number))
    verses[(5, 13, 16)], last = split_at(verses[(5, 13, 16)], " നിന്റെ ദൈവമായ യഹോവയുടെ വാക്കുകേട്ട്")
    verses[(5, 13, 17)] = verses.pop((5, 13, 18))
    verses[(5, 13, 18)] = last

    verses[(5, 28, 68)], first = split_at(verses[(5, 28, 68)], " ഹോരേബിൽവച്ച്")
    verses[(5, 29, 29)] = verses.pop((5, 29, 28))
    for number in range(27, 0, -1):
        verses[(5, 29, number + 1)] = verses.pop((5, 29, number))
    verses[(5, 29, 1)] = first

    verses[(9, 30, 30)], verses[(9, 30, 31)] = split_at(
        verses[(9, 30, 30)], " ഹെബ്രോനിലുള്ളവർക്കും"
    )
    verses[(10, 17, 28)], verses[(10, 17, 29)] = split_at(
        verses[(10, 17, 28)], " തേൻ"
    )
    verses[(22, 6, 13)] = verses.pop((22, 7, 1))
    for number in range(2, 12):
        verses[(22, 7, number - 1)] = verses.pop((22, 7, number))
    verses[(22, 7, 11)], verses[(22, 7, 12)] = split_at(
        verses[(22, 7, 12)], " അതികാലത്ത്"
    )

    verses[(44, 15, 18)] += " [The Malayalam wording differs from KJV here.]"
    verses[(44, 15, 25)] += " " + verses[(44, 15, 26)] + " [Malayalam verses 25–26 are combined here.]"
    verses[(44, 15, 26)] = "[Combined with Malayalam verse 25.]"
    verses[(44, 15, 28)] += " " + "[Malayalam verses 28–29 are combined here.]"
    verses[(44, 15, 29)] = "[Combined with Malayalam verse 28.]"
    verses[(44, 15, 35)] = verses.pop((44, 15, 34))
    verses[(44, 15, 34)] = "[Malayalam verse unavailable in this edition.]"
    verses[(44, 28, 29)] = "[Malayalam verse unavailable in this edition.]"
    verses[(45, 16, 25)] = " ".join(
        verses.pop((45, 16, number)) for number in (24, 26, 27)
    ) + " [Malayalam verses 25–27 are combined here; their order differs from KJV.]"
    verses[(45, 16, 24)] = "[Malayalam verse unavailable in this edition.]"
    verses[(45, 16, 26)] = "[Combined with Malayalam verse 25.]"
    verses[(45, 16, 27)] = "[Combined with Malayalam verse 25.]"
    verses[(55, 3, 6)] += " " + verses[(55, 3, 7)] + " [Malayalam verses 6–7 are combined here.]"
    verses[(55, 3, 7)] = "[Combined with Malayalam verse 6.]"
    verses[(64, 1, 14)] += " " + verses.pop((64, 1, 15))
    verses[(66, 13, 1)] = verses.pop((66, 12, 18)) + " " + verses[(66, 13, 1)]
    return verses


def import_database(database, data):
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("The Malayalam source archive does not match the pinned SHA-256.")
    verses, bridges, chapters = parse_source(data)
    verses = align_verses(verses, bridges)
    with sqlite3.connect(database) as db:
        expected = set(db.execute("SELECT book_id, chapter_id, verse_id FROM verses_kjv"))
        if set(verses) != expected:
            missing = sorted(expected - set(verses))
            extra = sorted(set(verses) - expected)
            raise ValueError(f"KJV reference mismatch. Missing: {missing}; extra: {extra}")
        expected_chapters = {(book, chapter) for book, chapter, _ in expected}
        if chapters != expected_chapters:
            raise ValueError("Source chapter coverage does not match KJV.")
        with db:
            db.execute("DELETE FROM verses")
            db.executemany(
                "INSERT INTO verses (book_id, chapter_id, verse_id, verse_text) VALUES (?, ?, ?, ?)",
                ((*key, text) for key, text in sorted(verses.items())),
            )
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Database integrity check failed.")
    return len(verses)


def main():
    if not DATABASE.is_file():
        raise SystemExit("Bible database is missing; import the original database first.")
    with urllib.request.urlopen(URL, timeout=60) as response:
        data = response.read()
    count = import_database(DATABASE, data)
    print(f"Imported {count:,} Malayalam KJV references from Free Bibles India.")


if __name__ == "__main__":
    main()
