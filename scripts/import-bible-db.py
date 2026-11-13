import os
import re
import shutil
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path


EXPECTED_CHUNKS = 27
EXPECTED_BOOKS = 66
EXPECTED_CHAPTERS = 1189
TABLES = ("verses", "verses_kjv", "verses_asv")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(
            'Usage: python scripts/import-bible-db.py "<decompiled-source-directory>"'
        )

    source = Path(sys.argv[1]) / "app" / "src" / "main" / "res" / "raw"
    chunks = sorted(
        path for path in source.iterdir()
        if path.is_file() and re.fullmatch(r"[a-z]{3}", path.name)
    )
    if len(chunks) != EXPECTED_CHUNKS:
        raise SystemExit(f"Expected {EXPECTED_CHUNKS} database chunks in {source}; found {len(chunks)}.")

    output = Path(__file__).resolve().parents[1] / "public" / "data" / "bible.sqlite"
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix="bible-", suffix=".sqlite", dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with temporary.open("wb") as database_file:
            for chunk in chunks:
                with chunk.open("rb") as source_file:
                    shutil.copyfileobj(source_file, database_file)

        with closing(sqlite3.connect(temporary)) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise RuntimeError(f"Database integrity check failed: {integrity}")

            book_count = connection.execute("SELECT COUNT(*) FROM books").fetchone()[0]
            if book_count != EXPECTED_BOOKS:
                raise RuntimeError(f"Expected {EXPECTED_BOOKS} books; found {book_count}.")

            for table in TABLES:
                chapter_count = connection.execute(
                    f"SELECT COUNT(DISTINCT book_id || ':' || chapter_id) FROM {table}"
                ).fetchone()[0]
                covered_books = connection.execute(
                    f"SELECT COUNT(DISTINCT book_id) FROM {table}"
                ).fetchone()[0]
                if covered_books != EXPECTED_BOOKS or chapter_count != EXPECTED_CHAPTERS:
                    raise RuntimeError(
                        f"{table} coverage mismatch: {covered_books} books, {chapter_count} chapters."
                    )

        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)

    print(f"Imported {len(chunks)} chunks into {output} ({output.stat().st_size:,} bytes).")
    for table in TABLES:
        with closing(sqlite3.connect(output)) as connection:
            verses = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"{table}: {verses:,} verses across {EXPECTED_BOOKS} books and {EXPECTED_CHAPTERS} chapters")


if __name__ == "__main__":
    main()
