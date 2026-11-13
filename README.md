# Malayalam Bible Reader

An offline-first responsive web reader packaged for Android with Capacitor. It includes the three Bible editions from the original app's database: Malayalam, English KJV, and English ASV.

## Bible data

The Bible database is included for private use. To rebuild it from the original app's decompiled source, run the following from the project directory:

```powershell
python scripts\import-bible-db.py "<decompiled-source-directory>"
```

The importer checks SQLite integrity, all 66 books, and coverage of all 1,189 chapters in each edition before writing `public\data\bible.sqlite`.

The original app's information page credits the Malayalam encoding to Nishad Kaippally and describes it as released under a Creative Commons license for non-commercial, non-profit use, but does not state a license version. It describes the English content as public domain. Keep the repository and deployment private unless the database's redistribution rights and attribution requirements are verified.

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

The production service worker pre-caches the app and Bible database for offline use. The first web visit must finish loading the app once before it can be used offline. Settings, last reading position, and bookmarks are stored on the device.

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

The Compose project, image, and container are named `malayalam-bible`. Docker publishes port 8834 on all host interfaces. The direct Windows server and Docker container cannot use that port at the same time. For offline caching on public hosts, serve the site over HTTPS.

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

- Browse all books and chapters in Malayalam and/or English.
- Read one language, verse-by-verse bilingual, balanced split (equal panes that stack in portrait and become columns in landscape), parallel (stacked synchronized panes), or side-by-side.
- Choose any combination of Malayalam, KJV, and ASV; the initial view is Malayalam + KJV to put the requested bilingual reader up front.
- Adjust both reading languages in Settings using Normal (100%), Big (150%), Bigger (200%), or Biggest (250%) zoom.
- Adjust theme, legacy Unicode rendering preference, and bookmark options.
- Select verses to copy, share, clear, or bookmark; bookmark a chapter; open and delete saved bookmarks; optionally group bookmarks by date.
- Continue at the last read chapter.

The supplied `app_icon.png` is used for the Android launcher and web app icons, with a warm off-white background for contrast.

