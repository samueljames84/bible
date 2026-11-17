# Bible

An offline-first responsive web reader packaged for Android with Capacitor. It includes Malayalam, Tamil, Hindi, and English KJV texts. The web version is available at <https://bible.sj84.net/>.

## Bible data

The Bible database is included for private use. To rebuild it from the original app's decompiled source, run the following from the project directory:

```powershell
python scripts\import-bible-db.py "<decompiled-source-directory>"
python scripts\import-tamil-bible.py
python scripts\import-malayalam-bible.py
python scripts\import-hindi-bible.py
```

The first importer replaces `public\data\bible.sqlite` with the original editions. The next three download pinned sources and add Tamil, replace Malayalam, and add Hindi; run all four commands when rebuilding the database. The Malayalam and Hindi imports verify the archive and perform their database changes transactionally.

Hindi text is from [Free Bibles India's Hindi Bible](https://github.com/FreeBiblesIndia/Hindi_Bible) (<http://www.freebiblesindia.in/bible/hin/>), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), pinned to revision `0bc468f`. Attribution and changes are in `public/HINDI-LICENSE.txt`. It is compatible with KJV numbering: every one of the 31,102 KJV chapter/verse references exists in the Hindi source with no boundary shifts. The source has two extra verses (3 John 1:15 and Revelation 12:18), which are merged into 3 John 1:14 and Revelation 13:1. Footnotes, headings, and cross-references are omitted. As with the other translations, matching numbers do not prove identical wording.

Tamil text is adapted from [Bible-tamil by Arul John](https://github.com/aruljohn/Bible-tamil), under the MIT license. Its copyright and license notice is included in `public/TAMIL-LICENSE.txt`.

Malayalam text is adapted from [Free Bibles India](https://github.com/FreeBiblesIndia/Malayalam_Bible), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Original work available at http://www.freebiblesindia.in. Attribution, changes, and license details are included in `public/MALAYALAM-LICENSE.txt`. The original app describes its English content as public domain; verify its terms before redistribution.

The Malayalam database uses KJV reference numbers, including boundary adjustments for Exodus 7–8, Deuteronomy 12–13 and 28–29, 1 Samuel 30, 2 Samuel 17, Song of Solomon 6–7, and 3 John 1. Malayalam Acts 15:34, Acts 28:29, and Romans 16:24 are unavailable in the source and are explicitly marked. Acts 15:25–26 and 28–29, Romans 16:25–27, and 2 Timothy 3:6–7 are shown as combined passages, with a note at each affected reference. Acts 15:18 has different wording. Revelation 12:18 is placed with 13:1; its source says the dragon stood on the sand, unlike KJV's wording. Formatting, source headings, and footnotes are omitted.

Number coverage does not prove semantic agreement: translations can use different word order or boundaries, and neither the Malayalam nor Tamil text has been comprehensively compared with KJV. The Malayalam source itself may contain errors; for example, Genesis 1:5 repeats the statement about naming day and night. A note flags that repetition; the source wording is retained rather than silently rewritten.

Existing bookmarks keep their saved reference numbers, so bookmarks in remapped chapters may now open a different Malayalam passage.
See [VERSE-REVIEW.md](VERSE-REVIEW.md) for the known differences and corrections to review.

## Run on the web

```powershell
npm install
npm run dev
```

For a production build with an offline service worker:

```powershell
npm test
npm run build
npm run preview
```

The production service worker pre-caches the app and Bible database for offline use. The first web visit must finish loading the app once before it can be used offline. Settings, last reading position, and bookmarks are stored on the device. The reader does not collect or send telemetry.

## Run directly on Windows

Install Node.js 20.19+ or 22.12+ (Node.js 21 is not supported). Ensure `public\data\bible.sqlite` exists, using the import instructions above if necessary. Run `setup-local.bat` once to install missing npm dependencies and build the app. Installing dependencies requires internet access; the running reader uses the bundled database.

Run `start_server.bat` to stop any server previously started by this app, rebuild, and start it at [http://localhost:8834](http://localhost:8834). Run `stop_server.bat` to stop it. Both work from any directory; pass `--no-pause` when running them from a terminal or automation. Logs and process state are stored in `.local`. If another application occupies port 8834, free that port first; these scripts do not stop unrelated processes.

The direct server listens on all host interfaces, so other devices that can reach the host may also access the reader. Restrict access with a firewall if needed. The web offline cache requires a secure browser context: `localhost` works for testing; other devices normally need HTTPS. Bookmarks and settings remain in each browser.

## Host with Docker

For Docker hosting, install Docker Engine with the Compose plugin and start the Docker daemon. The first build needs internet access to download the base images and npm dependencies. Ensure the included `public/data/bible.sqlite` file is present.

For Linux, macOS, or Git Bash, `sh setup.sh` checks Docker and builds the image. Then start or stop it from this directory:

```sh
docker compose -f compose.yaml up -d --wait
docker compose -f compose.yaml stop
```

The Compose project, image, and container are named `bible`; the service remains `bible-reader`. Docker publishes port 8834 on all host interfaces. If upgrading from the previous `malayalam-bible` container, stop it with `docker stop malayalam-bible` before starting the new container, or it will keep port 8834 occupied. The old container is not removed automatically. The direct Windows server and Docker container cannot use that port at the same time. For offline caching on public hosts, serve the site over HTTPS.

## Package for Android

Android compiles and targets API 35. Install JDK 21 and the Android SDK, and set `JAVA_HOME` and `ANDROID_HOME` to their respective installation directories. The generated Gradle 8.14.3 wrapper is not compatible with JDK 25.

```powershell
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
npm run android:sync
Push-Location .\android
.\gradlew.bat assembleDebug
Pop-Location
```

The debug APK is written to `android\app\build\outputs\apk\debug\app-debug.apk`. The Android project has already been generated; `npm run android:add` is only needed if setting up the native project from scratch. The app removes Android's `INTERNET` permission, includes no advertising SDK, and uses only bundled Bible data; reading requires no network access.

## Features

- Browse all books and chapters in Malayalam, Tamil, and/or English.
- Distinguish Old and New Testament book cards by two shades of the selected theme (grayscale for white, Black, and Dark Grey).
- Read one language, verse-by-verse bilingual, balanced split (equal panes that stack in portrait and become columns in landscape), parallel (stacked synchronized panes), or side-by-side.
- The default is Tamil with Malayalam as the second language. Choose any combination of Tamil, Malayalam, and KJV. Turn the second view on or off in Settings; its language and layout controls are hidden in single view, and their selections are remembered.
- Balanced and parallel panes align corresponding verses and scroll together.
- Split-view scroll synchronization mirrors each source update without a frame-wide lock, keeping high-refresh-rate scrolling responsive.
- Adjust both reading languages in Settings using Normal (100%), Big (150%), Bigger (200%), or Biggest (250%) zoom, and optionally bold reading text. The bold setting does not affect presentations.
- On the website, open the current chapter and primary language in a separate presentation tab. Use the arrow keys to advance or go back two KJV reference numbers at a time with a 0.3-second transition, even when system animations are disabled; presentation never changes chapter. On touchscreens, swipe left or up for next, and right or down for previous, with no extra on-screen controls. Taps and small movements are ignored, and pinch-to-zoom remains available. The heading shows the top displayed reference and KJV chapter total. Unavailable and cross-reference-only entries are skipped, so a slide may start at the next available verse when its odd-numbered start is unavailable. The text size is fitted to the chapter and recalculated on resize; as many complete verses as fit are shown, followed by a centered end marker after the last verse.
- Adjust theme (including Dark Green, Black, and Dark Grey), legacy Unicode rendering preference, and bookmark options. The original green-tinted Black theme is retained as Dark Green.
- Select verses to copy, share, clear, or bookmark; bookmark a chapter; open and delete saved bookmarks; optionally group bookmarks by date.
- Import and export bookmark backups as JSON from the Bookmarks page on the website or Android. Imports merge with existing bookmarks and skip duplicate passages; the Android system file picker lets you choose where to save or open the backup.
- Back navigation (on-screen Back and the Android back button): reader → chapter selection → home; Bookmarks, Settings and Info return to chapter selection (if a book is open) or home.
- Optionally support server costs through the external Buy Me a Coffee link or the Google Pay / UPI QR code beside it on the Info page. Both images are bundled for offline display; opening the donation website requires internet access and is subject to that site's privacy practices.
- Continue at the last read chapter.

The supplied `app_icon.png` is used for the Android launcher and web app icons, with a warm off-white background for contrast.

