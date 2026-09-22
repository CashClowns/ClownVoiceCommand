/* Adds the microphone and speech usage strings to the generated Info.plist.
   Runs in CI after `cap add ios`, because that folder is generated, not committed. */
const fs = require("fs");
const p = "ios/App/App/Info.plist";
let s = fs.readFileSync(p, "utf8");
const add = {
  NSMicrophoneUsageDescription:
    "ClownVoiceAI records your practice takes so it can score your pace, pauses and tone. Recordings stay on this device.",
  NSSpeechRecognitionUsageDescription:
    "ClownVoiceAI turns your practice take into text on this device so it can count filler words. Nothing is uploaded."
};
for (const [k, v] of Object.entries(add)) {
  if (s.includes(`<key>${k}</key>`)) continue;           // already there, leave it
  s = s.replace("</dict>\n</plist>", `  <key>${k}</key>\n  <string>${v}</string>\n</dict>\n</plist>`);
}
fs.writeFileSync(p, s);
console.log("Info.plist usage strings written");
