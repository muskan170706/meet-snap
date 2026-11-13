# MeetSnap - Google Meet Camera Interception Extension

A lightweight Chrome Manifest V3 extension that intercepts `navigator.mediaDevices.getUserMedia` on `meet.google.com` using a `MAIN` world content script, renders the camera stream onto an offscreen canvas with a red tint overlay at 30 FPS, and returns the modified stream with the original audio track intact.

---

## Project Structure

```
meet-snap/
├── manifest.json   # Manifest V3 configuration (MAIN world, document_start)
├── content.js      # getUserMedia interception, offscreen canvas & red tint pipeline
└── README.md       # Setup and loading guide
```

---

## How to Load in Google Chrome ("Load unpacked")

1. Open Google Chrome.
2. Navigate to `chrome://extensions` in the address bar.
3. In the top-right corner, toggle on **Developer mode**.
4. Click the **Load unpacked** button in the top-left toolbar.
5. In the file picker dialog, select this folder:
   ```
   /Users/muskankataria/Documents/meet-snap
   ```
6. The extension **MeetSnap** will now appear in your installed extensions list.

---

## How to Verify It Works

1. Open a new tab and go to [Google Meet](https://meet.google.com).
2. Start a new instant meeting or join an existing meeting.
3. Check the camera preview:
   - Your camera feed will display with a noticeable **RED TINT** overlay.
   - Microphone audio remains untouched and functions normally.
4. Open Chrome DevTools (`Cmd + Option + I` on macOS):
   - In the **Console** tab, you will see `[MeetSnap]` logs:
     - `[MeetSnap] Content script running in MAIN world at document_start.`
     - `[MeetSnap] navigator.mediaDevices.getUserMedia successfully intercepted.`
     - `[MeetSnap] Interception active: returning canvas stream with original audio.`
