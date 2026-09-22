# ClownVoiceAI, iOS build kit

What this is: the files needed to turn the existing web app into an iOS app with Capacitor and build it
on a GitHub macOS runner. No Mac required. Nothing here changes the web app itself.

## Files

| File | What it does |
|---|---|
| package.json | Capacitor and the two plugins the app needs |
| capacitor.config.json | App id io.github.cashclowns.clownvoiceai, name ClownVoiceAI, web files in www/ |
| ios-permissions.js | Writes the microphone and speech usage strings into Info.plist during the build |
| .github/workflows/ios.yml | Builds, signs and uploads to TestFlight on a macos-14 runner |
| www/ | A copy of the current web app. The build wraps whatever is in here |

## Before the first build

1. Apple Developer Program membership. Nothing ships to TestFlight without it.
2. In App Store Connect create the app record with bundle id io.github.cashclowns.clownvoiceai.
3. Create an App Store Connect API key (Users and Access, Integrations). Save the .p8, the key id and the issuer id.
4. Create an Apple distribution certificate and an App Store provisioning profile for that bundle id.
   On Windows this is the awkward part. Two options: use a service like Codemagic or Fastlane Match to
   generate them, or generate the CSR with OpenSSL on Windows and upload it in the Apple portal.
5. Put the seven secrets listed at the top of ios.yml into the repo under Settings, Secrets and variables, Actions.
6. Run the workflow by hand from the Actions tab.

## Keep in mind

- www/ is a copy, not a link. When the web app changes, copy the changed files into www/ again, or add a
  build step that pulls them from the main app folder.
- The API key must move behind a Cloud Function before submission. A key inside www/ ships to every device
  that installs the app and can be extracted from the bundle.
- The browser Whisper model is 45 to 85 MB of wasm inside a web view. Expect memory pressure on older iPhones.
  The speech-recognition plugin in package.json is the native replacement. Swap it in before you submit.
- App Review guideline 4.2 rejects thin web wrappers. Native microphone capture, offline use and on-device
  scoring are the argument that this is a real app. Do not submit a build that is only a web view pointed at
  the public site.
