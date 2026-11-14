import io
import json
import sqlite3
import urllib.request
import zipfile
from pathlib import Path


REVISION = "f417f8ed970d52b2dd52922849069c70c74b2622"
URL = f"https://codeload.github.com/aruljohn/Bible-tamil/zip/{REVISION}"
DATABASE = Path(__file__).resolve().parents[1] / "public" / "data" / "bible.sqlite"


def main():
    if not DATABASE.is_file():
        raise SystemExit("Bible database is missing; import the original database first.")

    with urllib.request.urlopen(URL, timeout=60) as response:
        archive_bytes = response.read()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        prefix = f"Bible-tamil-{REVISION}/"
        source_books = json.loads(archive.read(prefix + "Books.json"))
        with sqlite3.connect(DATABASE) as db:
            local_books = db.execute(
                "SELECT book_id, EnglishShortName, num_chptr FROM books ORDER BY book_id"
            ).fetchall()
            if len(source_books) != 66 or len(local_books) != 66:
                raise ValueError("Both databases must contain 66 books.")
            tamil_books = []
            verses = []
            for (book_id, local_name, chapter_count), source in zip(local_books, source_books):
                names = source["book"]
                english = names["english"]
                expected = "Song of Songs" if local_name.strip() == "Song of Solomon" else local_name.strip()
                if english != expected or not names["tamil"].strip():
                    raise ValueError(f"Unexpected book mapping: {local_name!r} / {english!r}")
                book = json.loads(archive.read(prefix + english + ".json"))
                chapters = book["chapters"]
                if [int(chapter["chapter"]) for chapter in chapters] != list(range(1, int(chapter_count) + 1)):
                    raise ValueError(f"Unexpected chapter coverage in {english}.")
                tamil_books.append((book_id, names["tamil"].strip()))
                for chapter in chapters:
                    chapter_id = int(chapter["chapter"])
                    for verse in chapter["verses"]:
                        verse_id = int(verse["verse"])
                        text = verse["text"].strip()
                        if verse_id < 1 or not text:
                            raise ValueError(f"Invalid verse in {english} {chapter_id}:{verse_id}.")
                        verses.append((book_id, chapter_id, verse_id, text))

            with db:
                db.execute("BEGIN")
                db.execute("DROP TABLE IF EXISTS verses_tamil")
                db.execute("DROP TABLE IF EXISTS tamil_books")
                db.execute("CREATE TABLE tamil_books (book_id INTEGER PRIMARY KEY, TamilShortName TEXT NOT NULL)")
                db.execute(
                    "CREATE TABLE verses_tamil (book_id INTEGER NOT NULL, chapter_id INTEGER NOT NULL, "
                    "verse_id INTEGER NOT NULL, verse_text TEXT NOT NULL, PRIMARY KEY (book_id, chapter_id, verse_id))"
                )
                db.executemany("INSERT INTO tamil_books VALUES (?, ?)", tamil_books)
                db.executemany("INSERT INTO verses_tamil VALUES (?, ?, ?, ?)", verses)
                if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Database integrity check failed.")
    print(f"Imported {len(tamil_books)} Tamil books and {len(verses)} verses.")


if __name__ == "__main__":
    main()
