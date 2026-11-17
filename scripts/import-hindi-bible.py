import hashlib
import io
import re
import sqlite3
import urllib.request
import zipfile
from pathlib import Path


REVISION = "0bc468f34cbfb77fefeb2685616e91fbd7d55101"
URL = f"https://codeload.github.com/FreeBiblesIndia/Hindi_Bible/zip/{REVISION}"
SHA256 = "b0ec9de1b58354fdd21c44806689e843c00cbb257bba04a204128955c958ddbd"
DATABASE = Path(__file__).resolve().parents[1] / "public" / "data" / "bible.sqlite"
BOOK_IDS = (
    "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB "
    "PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP "
    "HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH "
    "1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV"
).split()
# The Hindi text has two more verses than the KJV; these are merged into their KJV neighbours.
EXTRA_VERSES = {(64, 1, 15), (66, 12, 18)}


def clean_text(text):
    text = re.sub(r"\\f\s+.*?\\f\*", "", text, flags=re.DOTALL)
    text = re.sub(r"\\bdit\s.*?\\bdit\*", "", text, flags=re.DOTALL)
    text = re.sub(r"\\it\s+\([^()\\]*\d+:\d+[^()\\]*\)\s*\\it\*", "", text)
    text = re.sub(r"\\\+?(?:wj|it|qs|tl|bdit)\*", "", text)
    text = re.sub(r"\\\+?(?:wj|it|qs|tl|bdit) ?", "", text)
    if "\\" in text:
        raise ValueError(f"Unrecognized inline marker in: {text[:100]!r}")
    text = re.sub(r"\s+", " ", text).strip()
    # Some editions' cross-references are plain trailing parentheses such as "(यशा. 40:3)".
    return re.sub(r"\s*\([^()\d]*\d+:\d+[^()]*\)$", "", text)


def parse_source(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = sorted(name for name in archive.namelist() if name.endswith(".usfm"))
        if len(files) != len(BOOK_IDS):
            raise ValueError(f"Expected 66 USFM books, found {len(files)}.")
        verses = {}
        names = []
        for book_id, (filename, expected_id) in enumerate(zip(files, BOOK_IDS), 1):
            text = archive.read(filename).decode("utf-8-sig")
            book_match = re.search(r"(?m)^\\id\s+(\S+)", text)
            if not book_match or book_match.group(1) != expected_id:
                raise ValueError(f"Unexpected book in {filename}: expected {expected_id}.")
            name_match = re.search(r"(?m)^\\toc2\s+(.+?)\s*$", text)
            if not name_match:
                raise ValueError(f"Missing book name in {filename}.")
            names.append((book_id, name_match.group(1)))
            # Footnotes may span lines, so remove them before reading line by line.
            text = re.sub(r"\\f\s+.*?\\f\*", "", text, flags=re.DOTALL)
            chapter = None
            current = None
            for line in text.splitlines():
                match = re.match(r"^\\c\s+(\d+)\s*$", line)
                if match:
                    chapter = int(match.group(1))
                    current = None
                    continue
                if chapter is None:
                    continue
                match = re.match(r"^\\v\s+(\d+)\s+(.+)$", line)
                if match:
                    current = (book_id, chapter, int(match.group(1)))
                    if current in verses:
                        raise ValueError(f"Duplicate verse: {filename} {chapter}:{current[2]}.")
                    verses[current] = match.group(2)
                    continue
                match = re.match(r"^\\(q[1-4]?|m)(?:\s+(.*))?$", line)
                if match:
                    if match.group(2):
                        if current is None:
                            raise ValueError(f"Text before a verse in {filename} {chapter}.")
                        verses[current] += " " + match.group(2)
                    continue
                if re.match(r"^\\v\s", line):
                    raise ValueError(f"Unexpected verse line in {filename} {chapter}: {line[:100]!r}")
        return {key: clean_text(text) for key, text in verses.items()}, names


def align_verses(verses):
    verses = verses.copy()
    if not EXTRA_VERSES <= set(verses):
        raise ValueError("Expected extra Hindi verses are missing.")
    verses[(64, 1, 14)] += " " + verses.pop((64, 1, 15))
    verses[(66, 13, 1)] = verses.pop((66, 12, 18)) + " " + verses[(66, 13, 1)]
    return verses


def import_database(database, data):
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("The Hindi source archive does not match the pinned SHA-256.")
    verses, names = parse_source(data)
    verses = align_verses(verses)
    with sqlite3.connect(database) as db:
        expected = set(db.execute("SELECT book_id, chapter_id, verse_id FROM verses_kjv"))
        if set(verses) != expected:
            missing = sorted(expected - set(verses))
            extra = sorted(set(verses) - expected)
            raise ValueError(f"KJV reference mismatch. Missing: {missing}; extra: {extra}")
        if any(not text for text in verses.values()):
            raise ValueError("Empty Hindi verse.")
        with db:
            db.execute("DROP TABLE IF EXISTS verses_hindi")
            db.execute("DROP TABLE IF EXISTS hindi_books")
            db.execute("CREATE TABLE hindi_books (book_id INTEGER PRIMARY KEY, HindiShortName TEXT NOT NULL)")
            db.execute(
                "CREATE TABLE verses_hindi (book_id INTEGER NOT NULL, chapter_id INTEGER NOT NULL, "
                "verse_id INTEGER NOT NULL, verse_text TEXT NOT NULL, PRIMARY KEY (book_id, chapter_id, verse_id))"
            )
            db.executemany("INSERT INTO hindi_books VALUES (?, ?)", names)
            db.executemany("INSERT INTO verses_hindi VALUES (?, ?, ?, ?)", sorted((*key, text) for key, text in verses.items()))
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Database integrity check failed.")
    return len(names), len(verses)


def main():
    if not DATABASE.is_file():
        raise SystemExit("Bible database is missing; import the original database first.")
    with urllib.request.urlopen(URL, timeout=60) as response:
        data = response.read()
    books, count = import_database(DATABASE, data)
    print(f"Imported {books} Hindi books and {count:,} KJV-aligned verses from Free Bibles India.")


if __name__ == "__main__":
    main()
