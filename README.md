# MeetSnap v1.0.4 - Google Meet Camera Disintegration with Speech Filtering

A Chrome Manifest V3 extension for Google Meet that intercepts the camera and microphone. On clap, the video frame disintegrates into thousands of particles that drift left, wobble, shrink, and fade to grey ash in a right-to-left wave. A second clap reverses the effect and fades the live camera video back in.

---

## What's New in v1.0.4: Speech Filtering vs Clap Detection

Previously, speaking words could trigger the effect because simple volume spikes occurred when starting to speak. In **v1.0.4**, a 4-layer audio discrimination algorithm distinguishes claps from speech:

1. **Higher Volume Threshold (`THRESHOLD = 0.14`, `MIN_VOLUME = 0.10`)**: Normal speech sits at ~`0.03 - 0.08` RMS, whereas claps produce sharp spikes of `0.15 - 0.40+`.
2. **Spectral High-Frequency Ratio (`HIGH_FREQ_RATIO = 0.50`)**:
   - Human speech is dominated by low vocal fundamentals and formants (< 1.5 kHz), resulting in a ratio of `0.10 - 0.35`.
   - Hand claps produce an acoustic impulse crack rich in high frequencies (2.5 kHz - 8.5 kHz), resulting in a ratio of `0.70 - 1.50+`.
3. **Transient Duration Guard (`consecutiveLoudFrames <= 3`)**:
   - Claps last only 20ms - 50ms (1 to 2 frames).
   - Spoken syllables sustain for 150ms - 400ms+, automatically disqualifying speech.
4. **1-Second Cooldown (`COOLDOWN = 1000`)**: Prevents rapid re-triggers.

---

## Tunable Parameters

At the top of [`content.js`](file:///Users/muskankataria/Documents/meet-snap/content.js#L7-L23):

```javascript
// Clap Detection vs Speech Filtering
const THRESHOLD = 0.14;           // Volume spike above rolling average (speech is typically < 0.08)
const MIN_VOLUME = 0.10;          // Minimum absolute volume required to consider a clap
const HIGH_FREQ_RATIO = 0.50;     // Ratio of high-freq energy (>2.5kHz) to low-freq vocal energy (<1.5kHz)
const COOLDOWN = 1000;            // Cooldown in ms between claps (1 second)

// Disintegration Effect Parameters
const GRID_SPACING = 6;           // Sample every 6th pixel (grid spacing)
const PARTICLE_SIZE = 7;          // Base particle size in pixels
const PARTICLE_SPEED = 3.5;       // Leftward drift speed (pixels per frame at 30fps)
const FADE_TIME_MS = 2200;        // Particle lifetime / fade duration in ms
const WAVE_DURATION_MS = 1400;    // Duration of right-to-left sweep delay in ms
const FADE_IN_DURATION_MS = 1000; // Duration for reverse video fade-in in ms
```

---

## How to Reload & Test

1. In Google Chrome, navigate to `chrome://extensions`.
2. Locate **MeetSnap** and click the circular **Reload** icon (🔄). Confirm the version is **1.0.4**.
3. Open a **new tab** to [meet.google.com](https://meet.google.com) (or hard-refresh an open meeting with `Cmd + Shift + R`).
4. Open Chrome DevTools (`Cmd + Option + I`) to the **Console** tab.
5. **Speak normally**:
   - The diagnostic logs will show: `vol: ~0.045, hfRatio: ~0.20`.
   - Notice that speech **does not** trigger the disintegration effect.
6. **Clap your hands**:
   - The volume and high-frequency ratio will spike (`vol: >0.15, hfRatio: >0.80`).
   - The video will immediately disintegrate into drifting ash particles.
7. **Clap a second time**:
   - The live video smoothly fades back in.
