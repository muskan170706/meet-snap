# MeetSnap v1.0.2 - Google Meet Camera & Clap Detection Extension

A lightweight Chrome Manifest V3 extension that intercepts `navigator.mediaDevices.getUserMedia` on `meet.google.com` using a `MAIN` world content script, renders the camera stream onto an offscreen canvas at 30 FPS, and toggles between a red tint and normal video whenever a clap is detected using the Web Audio API on a cloned microphone track.

---

## Features

1. **Camera Interception**:
   - Intercepts video `getUserMedia` requests.
   - Decodes camera video in an offscreen video element and draws to an offscreen canvas at 30 FPS.
   - Applies red tint (`rgba(255, 0, 0, 0.4)`) by default, which can be toggled on/off.
2. **Clap Detection**:
   - Intercepts audio `getUserMedia` requests (audio-only or audio+video).
   - Clones the audio track (`audioTrack.clone()`) and feeds it to Web Audio (`AudioContext` -> `MediaStreamSource` -> `AnalyserNode` -> `silentGain` -> `destination`).
   - Leave's Google Meet's real audio stream 100% unaltered.
   - Analyzes RMS volume every 20ms and triggers when `vol - rollingAverage >= THRESHOLD`.
   - Cooldown of 1 second (`COOLDOWN`) prevents duplicate triggers.
   - Toggles red tint on/off and logs `[MeetSnap] CLAP detected, volume: <vol>`.
   - Logs `[MeetSnap] volume: <vol> threshold: <THRESHOLD>` every 1000ms.

---

## Tunable Parameters

At the top of [`content.js`](file:///Users/muskankataria/Documents/meet-snap/content.js#L7-L18):

```javascript
// Threshold for volume spike (currentVolume - rollingAverage) to detect a clap
const THRESHOLD = 0.05;

// Cooldown period in milliseconds to prevent double firing
const COOLDOWN = 1000;
```

---

## How to Reload & Test

1. Open `chrome://extensions` in Google Chrome.
2. Find **MeetSnap** and click the circular **Reload** icon (🔄).
3. Confirm the version displays **1.0.2**.
4. Open a **new tab** to [meet.google.com](https://meet.google.com) (or hard-refresh with `Cmd + Shift + R`).
5. Open Chrome DevTools (`Cmd + Option + I`) to the **Console** tab:
   - You will see:
     ```
     [MeetSnap v1.0.2] INITIALIZED - MAIN world script active
     [MeetSnap] Audio detector attached, state: running
     [MeetSnap] Intercepting video track: ...
     [MeetSnap] volume: 0.0025 threshold: 0.05
     ```
6. Both your camera (with the red tint) and your microphone are active.
7. Clap near the microphone to toggle the red tint on and off!
