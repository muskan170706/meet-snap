/**
 * MeetSnap v1.0.4 - Google Meet Camera Stream Interceptor with Speech-Filtered Clap Detection & Disintegration Effect
 * Injected in MAIN world at document_start.
 */

// ==================== Tunable Configuration ====================
// Clap Detection vs Speech Filtering
const THRESHOLD = 0.14;           // Volume spike above rolling average (speech is typically < 0.08)
const MIN_VOLUME = 0.10;          // Minimum absolute volume required to consider a clap
const HIGH_FREQ_RATIO = 0.50;     // Minimum ratio of high-freq energy (>2.5kHz) to low-freq energy (<1.5kHz). Speech is <0.3, claps are >0.7.
const COOLDOWN = 1000;            // Cooldown in ms between claps (1 second)
const ROLLING_AVG_ALPHA = 0.05;   // Rolling average smoothing factor

// Disintegration Effect Parameters
const GRID_SPACING = 6;           // Sample every 6th pixel (grid spacing)
const PARTICLE_SIZE = 7;          // Base particle size in pixels
const PARTICLE_SPEED = 3.5;       // Leftward drift speed (pixels per frame at 30fps)
const FADE_TIME_MS = 2200;        // Particle lifetime / fade duration in ms
const WAVE_DURATION_MS = 1400;    // Duration of the right-to-left wave sweep in ms
const FADE_IN_DURATION_MS = 1000; // Duration for the reverse video fade-in in ms
// ==============================================================

(() => {
  // Prevent duplicate execution if re-injected
  if (window.__meetSnapInjected) return;
  window.__meetSnapInjected = true;

  console.log('%c[MeetSnap v1.0.4] INITIALIZED - Speech-Filtered Clap & Disintegration Active', 'background: #007acc; color: white; font-size: 13px; font-weight: bold; padding: 3px 6px; border-radius: 3px;');

  // Effect state machine: 'NORMAL', 'DISINTEGRATING', 'DARK', 'FADING_IN'
  const STATE_NORMAL = 'NORMAL';
  const STATE_DISINTEGRATING = 'DISINTEGRATING';
  const STATE_DARK = 'DARK';
  const STATE_FADING_IN = 'FADING_IN';
  let effectState = STATE_NORMAL;

  // Particle data arrays (TypedArrays for 60fps performance without garbage collection pauses)
  let particleCount = 0;
  let pX0 = null;
  let pY0 = null;
  let pVx = null;
  let pVy = null;
  let pWobblePhase = null;
  let pDelay = null;
  let pR = null;
  let pG = null;
  let pB = null;
  let pAsh = null;

  let disintegrationStartTime = 0;
  let fadeInStartTime = 0;

  // Reusable pixel buffer for direct memory blitting
  let disintegrateImageData = null;
  let disintegrateBuf32 = null;

  // Video element reference
  let activeVideoElement = null;
  let activeCanvasElement = null;
  let activeCanvasCtx = null;

  // Track IDs that have already had a clap detector attached
  const attachedTrackIds = new Set();
  const activeDetectors = [];

  /**
   * Helper to draw a filled square block of pixels into a 32-bit pixel buffer.
   */
  function drawBlock(buf, w, h, cx, cy, size, color32) {
    const half = (size >> 1);
    const startX = cx - half;
    const startY = cy - half;
    const endX = startX + size;
    const endY = startY + size;

    const minX = startX < 0 ? 0 : startX;
    const maxX = endX > w ? w : endX;
    const minY = startY < 0 ? 0 : startY;
    const maxY = endY > h ? h : endY;

    for (let y = minY; y < maxY; y++) {
      const rowOffset = y * w;
      for (let x = minX; x < maxX; x++) {
        buf[rowOffset + x] = color32;
      }
    }
  }

  /**
   * Samples the current video frame on a grid and initiates the right-to-left disintegration.
   */
  function startDisintegration() {
    if (!activeVideoElement || !activeCanvasElement || !activeCanvasCtx) return;
    if (!activeVideoElement.videoWidth || !activeVideoElement.videoHeight) return;

    const w = activeCanvasElement.width;
    const h = activeCanvasElement.height;

    // Offscreen canvas to capture the raw pixel frame
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = w;
    sampleCanvas.height = h;
    const sampleCtx = sampleCanvas.getContext('2d');
    sampleCtx.drawImage(activeVideoElement, 0, 0, w, h);

    const imgData = sampleCtx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const countX = Math.ceil(w / GRID_SPACING);
    const countY = Math.ceil(h / GRID_SPACING);
    const totalMax = countX * countY;

    // Allocate / reuse TypedArrays
    pX0 = new Float32Array(totalMax);
    pY0 = new Float32Array(totalMax);
    pVx = new Float32Array(totalMax);
    pVy = new Float32Array(totalMax);
    pWobblePhase = new Float32Array(totalMax);
    pDelay = new Float32Array(totalMax);
    pR = new Uint8Array(totalMax);
    pG = new Uint8Array(totalMax);
    pB = new Uint8Array(totalMax);
    pAsh = new Uint8Array(totalMax);

    let idx = 0;
    for (let y = 0; y < h; y += GRID_SPACING) {
      for (let x = 0; x < w; x += GRID_SPACING) {
        const pixelIdx = (y * w + x) * 4;
        const r = data[pixelIdx];
        const g = data[pixelIdx + 1];
        const b = data[pixelIdx + 2];

        pX0[idx] = x;
        pY0[idx] = y;

        // Leftward drift speed with natural variance
        pVx[idx] = PARTICLE_SPEED * (0.8 + Math.random() * 0.5);
        // Slight random vertical drift
        pVy[idx] = (Math.random() - 0.5) * 0.9;
        pWobblePhase[idx] = Math.random() * Math.PI * 2;

        // Wave sweep delay weighted by X position (right side starts first, sweeps left)
        const normalizedX = x / w; // 0 on left, 1 on right
        const jitter = (Math.random() - 0.5) * 160;
        const delay = Math.max(0, (1 - normalizedX) * WAVE_DURATION_MS + jitter);
        pDelay[idx] = delay;

        pR[idx] = r;
        pG[idx] = g;
        pB[idx] = b;

        // Soft grey ash value
        pAsh[idx] = Math.floor((0.299 * r + 0.587 * g + 0.114 * b) * 0.6);

        idx++;
      }
    }

    particleCount = idx;
    disintegrationStartTime = performance.now();

    // Recreate image buffer if dimensions changed
    if (!disintegrateImageData || disintegrateImageData.width !== w || disintegrateImageData.height !== h) {
      disintegrateImageData = activeCanvasCtx.createImageData(w, h);
      disintegrateBuf32 = new Uint32Array(disintegrateImageData.data.buffer);
    }

    effectState = STATE_DISINTEGRATING;
    console.log('[MeetSnap] Disintegration wave started with', particleCount, 'particles.');
  }

  /**
   * Renders one frame of the particle disintegration effect.
   */
  function renderDisintegration(now) {
    const w = activeCanvasElement.width;
    const h = activeCanvasElement.height;
    const elapsed = now - disintegrationStartTime;

    // Fill buffer with opaque solid black (0xFF000000 in little-endian ABGR)
    disintegrateBuf32.fill(0xFF000000);

    let activeParticlesRemaining = 0;

    for (let i = 0; i < particleCount; i++) {
      const delay = pDelay[i];

      // Particle waiting for wave to reach it: draw at original position and color
      if (elapsed < delay) {
        activeParticlesRemaining++;
        const x = Math.round(pX0[i]);
        const y = Math.round(pY0[i]);
        const color32 = (255 << 24) | (pB[i] << 16) | (pG[i] << 8) | pR[i];
        drawBlock(disintegrateBuf32, w, h, x, y, PARTICLE_SIZE, color32);
        continue;
      }

      const lifeElapsed = elapsed - delay;
      const progress = lifeElapsed / FADE_TIME_MS;

      // Particle has completely faded away
      if (progress >= 1.0) {
        continue;
      }

      activeParticlesRemaining++;

      // Motion: drifts LEFT with slight vertical wobble
      const frames = lifeElapsed / (1000 / 30);
      const x = Math.round(pX0[i] - pVx[i] * frames);
      const y = Math.round(pY0[i] + pVy[i] * frames + Math.sin(frames * 0.15 + pWobblePhase[i]) * 3.0);

      // Particle shrinks
      const size = Math.max(1, Math.round(PARTICLE_SIZE * (1 - progress * 0.75)));

      // Color fades to grey ash
      const ashFactor = Math.min(1.0, progress * 1.4);
      const r = pR[i] * (1 - ashFactor) + pAsh[i] * ashFactor;
      const g = pG[i] * (1 - ashFactor) + pAsh[i] * ashFactor;
      const b = pB[i] * (1 - ashFactor) + pAsh[i] * ashFactor;

      // Opacity fades out into the dark background
      const alpha = progress < 0.4 ? 1.0 : (1.0 - (progress - 0.4) / 0.6);
      const finalR = Math.round(r * alpha);
      const finalG = Math.round(g * alpha);
      const finalB = Math.round(b * alpha);

      const color32 = (255 << 24) | (finalB << 16) | (finalG << 8) | finalR;
      drawBlock(disintegrateBuf32, w, h, x, y, size, color32);
    }

    activeCanvasCtx.putImageData(disintegrateImageData, 0, 0);

    // All particles have faded: transition to blank / dark frame
    if (activeParticlesRemaining === 0) {
      effectState = STATE_DARK;
      console.log('[MeetSnap] Disintegration complete. Blank/dark frame active.');
    }
  }

  /**
   * Called whenever a valid clap is detected.
   */
  function handleClap(vol) {
    console.log('[MeetSnap] CLAP detected, volume:', vol);

    if (effectState === STATE_NORMAL) {
      console.log('[MeetSnap] Triggering disintegration effect...');
      startDisintegration();
    } else if (effectState === STATE_DISINTEGRATING || effectState === STATE_DARK) {
      console.log('[MeetSnap] Reversing effect: fading video back in...');
      fadeInStartTime = performance.now();
      effectState = STATE_FADING_IN;
    }
  }

  /**
   * Attaches clap detection with speech filtering to an audio track once per track.
   */
  function attachClapDetector(audioTrack) {
    if (!audioTrack) return;
    if (attachedTrackIds.has(audioTrack.id)) {
      return;
    }
    attachedTrackIds.add(audioTrack.id);

    try {
      console.log('[MeetSnap] Setting up clap detection on track:', audioTrack.label || audioTrack.id);

      // Create an isolated clone of the audio track
      const clonedTrack = audioTrack.clone();
      const clonedStream = new MediaStream([clonedTrack]);

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('[MeetSnap] Web Audio API is not supported in this environment.');
        return;
      }

      const ctx = new AudioContextClass();
      const source = ctx.createMediaStreamSource(clonedStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      // Connect to a silent GainNode leading to destination so Chrome continuously pulls PCM buffers
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      analyser.connect(silentGain);
      silentGain.connect(ctx.destination);

      // Resume context if suspended
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      // Resume on first click or keydown on the document
      const resumeOnInteraction = () => {
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().then(() => {
            console.log('[MeetSnap] AudioContext resumed, state:', ctx.state);
          }).catch(() => {});
        }
      };
      document.addEventListener('click', resumeOnInteraction, { passive: true });
      document.addEventListener('keydown', resumeOnInteraction, { passive: true });

      console.log('[MeetSnap] Audio detector attached, state:', ctx.state);

      let currentVolume = 0;
      let currentHfRatio = 0;
      let rollingAverage = 0;
      let lastClapTime = 0;
      let consecutiveLoudFrames = 0;

      const pcmData = new Float32Array(analyser.fftSize);
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      // Sample audio every 20ms
      const sampleInterval = setInterval(() => {
        if (!analyser) return;

        // 1. Compute RMS Volume from Time Domain Waveform
        analyser.getFloatTimeDomainData(pcmData);
        let sumSquares = 0;
        for (let i = 0; i < pcmData.length; i++) {
          const sample = pcmData[i];
          sumSquares += sample * sample;
        }
        const vol = Math.sqrt(sumSquares / pcmData.length);
        currentVolume = vol;

        // 2. Compute Spectral High-Frequency Ratio from Frequency Domain
        analyser.getByteFrequencyData(freqData);

        // Low frequencies (voice fundamentals & formants, ~90Hz - 1500Hz: bins 1..16)
        let lowSum = 0;
        for (let b = 1; b <= 16; b++) {
          lowSum += freqData[b];
        }
        const lowAvg = lowSum / 16;

        // High frequencies (percussive clap crack, ~2500Hz - 8500Hz: bins 27..90)
        let highSum = 0;
        for (let b = 27; b <= 90; b++) {
          highSum += freqData[b];
        }
        const highAvg = highSum / 64;

        // Ratio of high frequency percussive energy to low vocal energy
        const hfRatio = highAvg / Math.max(1, lowAvg);
        currentHfRatio = hfRatio;

        // 3. Track loud duration to reject sustained speech
        if (vol > 0.07) {
          consecutiveLoudFrames++;
        } else {
          consecutiveLoudFrames = 0;
        }

        // 4. Update rolling average
        if (rollingAverage === 0) {
          rollingAverage = vol;
        } else {
          rollingAverage = (1 - ROLLING_AVG_ALPHA) * rollingAverage + ROLLING_AVG_ALPHA * vol;
        }

        const spike = vol - rollingAverage;
        const now = Date.now();

        // 5. Multi-Criteria Clap Detection:
        // - Volume spike exceeds THRESHOLD
        // - Absolute volume exceeds MIN_VOLUME (speech is typically < 0.08)
        // - High frequency ratio exceeds HIGH_FREQ_RATIO (claps are rich in high-freq percussives, speech is low-freq dominant)
        // - Transient check: consecutive loud frames <= 3 (claps last < 60ms; speech lasts 150-400ms+)
        // - Cooldown elapsed
        const isClap =
          spike >= THRESHOLD &&
          vol >= MIN_VOLUME &&
          hfRatio >= HIGH_FREQ_RATIO &&
          consecutiveLoudFrames <= 3 &&
          (now - lastClapTime >= COOLDOWN);

        if (isClap) {
          lastClapTime = now;
          console.log(`[MeetSnap] CLAP confirmed! vol=${vol.toFixed(3)} spike=${spike.toFixed(3)} hfRatio=${hfRatio.toFixed(2)}`);
          handleClap(vol);
        }
      }, 20);

      // Periodic diagnostic log every 1000ms
      const logInterval = setInterval(() => {
        if (ctx && ctx.state !== 'closed') {
          console.log(`[MeetSnap] vol: ${currentVolume.toFixed(3)} (spike: ${(currentVolume - rollingAverage).toFixed(3)}, hfRatio: ${currentHfRatio.toFixed(2)}) | threshold: ${THRESHOLD}`);
        }
      }, 1000);

      const detectorRecord = {
        ctx,
        source,
        analyser,
        silentGain,
        clonedTrack,
        clonedStream,
        sampleInterval,
        logInterval
      };
      activeDetectors.push(detectorRecord);

      // Cleanup when track ends
      const cleanup = () => {
        clearInterval(sampleInterval);
        clearInterval(logInterval);
        document.removeEventListener('click', resumeOnInteraction);
        document.removeEventListener('keydown', resumeOnInteraction);
        try { source.disconnect(); } catch (_) {}
        try { analyser.disconnect(); } catch (_) {}
        try { silentGain.disconnect(); } catch (_) {}
        if (ctx && ctx.state !== 'closed') {
          ctx.close().catch(() => {});
        }
        clonedTrack.stop();
        attachedTrackIds.delete(audioTrack.id);
        const idx = activeDetectors.indexOf(detectorRecord);
        if (idx !== -1) activeDetectors.splice(idx, 1);
      };

      audioTrack.addEventListener('ended', cleanup, { once: true });
      clonedTrack.addEventListener('ended', cleanup, { once: true });
    } catch (err) {
      console.error('[MeetSnap] Error attaching clap detector:', err);
    }
  }

  // Locate the original getUserMedia method
  const originalGetUserMedia =
    (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : (window.MediaDevices && MediaDevices.prototype && MediaDevices.prototype.getUserMedia)
        ? MediaDevices.prototype.getUserMedia
        : null;

  if (!originalGetUserMedia) {
    console.error('[MeetSnap] Could not find navigator.mediaDevices.getUserMedia to intercept.');
    return;
  }

  /**
   * Intercepted getUserMedia implementation
   */
  async function interceptedGetUserMedia(constraints) {
    console.log('[MeetSnap] getUserMedia invoked with constraints:', constraints);

    // Call the original getUserMedia to acquire the real stream
    const realStream = await originalGetUserMedia.call(navigator.mediaDevices, constraints);

    // For ANY request that returns an audio track (audio-only or audio+video),
    // attach clap detection to it once per track.
    try {
      const audioTracks = realStream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log('[MeetSnap] Found', audioTracks.length, 'audio track(s) in getUserMedia result.');
        audioTracks.forEach((track) => attachClapDetector(track));
      }
    } catch (e) {
      console.error('[MeetSnap] Error checking audio tracks:', e);
    }

    // Check if video was requested and returned
    const hasVideoRequested = Boolean(constraints && constraints.video);
    const videoTracks = realStream.getVideoTracks();

    // If request has no video or no video track was returned, pass the stream through unchanged
    if (!hasVideoRequested || videoTracks.length === 0) {
      return realStream;
    }

    // Video requested and present: intercept and return canvas stream
    const realVideoTrack = videoTracks[0];
    console.log('[MeetSnap] Intercepting video track:', realVideoTrack.label || realVideoTrack.id);

    // Offscreen HTML video element to decode and play real camera stream
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = realStream;
    activeVideoElement = video;

    // Offscreen canvas for frame drawing and visual effect processing
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    activeCanvasElement = canvas;
    activeCanvasCtx = ctx;

    // Initial frame fill
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let animId = null;

    // Render loop using requestAnimationFrame at 30/60 FPS
    function renderLoop(now) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const width = video.videoWidth;
        const height = video.videoHeight;

        if (width > 0 && height > 0) {
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }

          // State machine rendering
          if (effectState === STATE_NORMAL) {
            // Normal live video playback
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          } else if (effectState === STATE_DISINTEGRATING) {
            // Particle disintegration wave
            renderDisintegration(now);
          } else if (effectState === STATE_DARK) {
            // Completely blank / dark frame after disintegration
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          } else if (effectState === STATE_FADING_IN) {
            // Video fading smoothly back in
            const elapsed = now - fadeInStartTime;
            const progress = Math.min(1.0, elapsed / FADE_IN_DURATION_MS);

            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.globalAlpha = progress;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1.0;

            if (progress >= 1.0) {
              effectState = STATE_NORMAL;
              console.log('[MeetSnap] Fade-in complete. Normal video restored.');
            }
          }
        }
      }
      animId = requestAnimationFrame(renderLoop);
    }

    animId = requestAnimationFrame(renderLoop);

    video.play().catch((err) => {
      console.warn('[MeetSnap] Video playback initiation error:', err);
    });

    // Capture the processed canvas stream at 30 FPS
    const canvasStream = canvas.captureStream(30);
    const canvasVideoTrack = canvasStream.getVideoTracks()[0];

    // Video cleanup helper
    function cleanupVideo() {
      if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
      video.pause();
      video.srcObject = null;
      realStream.getVideoTracks().forEach((track) => track.stop());
    }

    // Proxy stop to release hardware camera resource
    const originalCanvasTrackStop = canvasVideoTrack.stop.bind(canvasVideoTrack);
    canvasVideoTrack.stop = function() {
      originalCanvasTrackStop();
      cleanupVideo();
    };

    realVideoTrack.addEventListener('ended', () => {
      canvasVideoTrack.stop();
    });

    // Mirror label, settings, and constraints to ensure compatibility with Google Meet
    try {
      Object.defineProperty(canvasVideoTrack, 'label', {
        get() {
          return realVideoTrack.label;
        }
      });
    } catch (_) {}

    if (realVideoTrack.getSettings) {
      const origGetSettings = canvasVideoTrack.getSettings.bind(canvasVideoTrack);
      canvasVideoTrack.getSettings = function() {
        const orig = origGetSettings ? origGetSettings() : {};
        const real = realVideoTrack.getSettings ? realVideoTrack.getSettings() : {};
        return {
          ...real,
          ...orig,
          deviceId: real.deviceId || orig.deviceId
        };
      };
    }

    if (realVideoTrack.applyConstraints) {
      canvasVideoTrack.applyConstraints = function(c) {
        return realVideoTrack.applyConstraints(c);
      };
    }

    // Combine canvas video track with original audio tracks
    const audioTracks = realStream.getAudioTracks();
    const interceptedStream = new MediaStream([canvasVideoTrack, ...audioTracks]);

    console.log('[MeetSnap] Interception active: returning canvas stream with original audio.');
    return interceptedStream;
  }

  // Override on both navigator.mediaDevices and prototype for maximum reliability
  try {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = interceptedGetUserMedia;
    }
  } catch (_) {}

  try {
    if (window.MediaDevices && MediaDevices.prototype) {
      MediaDevices.prototype.getUserMedia = interceptedGetUserMedia;
    }
  } catch (_) {}

  // Support legacy navigator.getUserMedia if present
  try {
    if (navigator.getUserMedia) {
      navigator.getUserMedia = function(constraints, success, error) {
        interceptedGetUserMedia(constraints).then(success).catch(error);
      };
    }
  } catch (_) {}

  console.log('[MeetSnap] navigator.mediaDevices.getUserMedia successfully intercepted.');
})();
