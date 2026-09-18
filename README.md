# ClownVoiceCommand

Speaking training app. Five daily drills, a full voice analyzer (pace, freezes, pauses, end-of-statement tone, pitch range, trail-off, um/uh estimate, loudness and pitch timeline) on live mic or any recording file, Claude scoring (optional API key), progress synced between PC and iPhone through Firebase.

Live: https://cashclowns.github.io/ClownVoiceCommand/

Files: index.html (app), analyzer.js (voice analysis engine: YIN pitch, adaptive voice activity, syllable-nuclei pace), config.js (Firebase web config), sw.js (offline cache), manifest.webmanifest and icons (home-screen install), firestore.rules (data is private per signed-in user).
