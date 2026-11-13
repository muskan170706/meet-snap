/**
 * MeetSnap v1.0.2 - Google Meet Camera Stream Interceptor with Clap Detection
 * Injected in MAIN world at document_start.
 */

// ==================== Tunable Configuration ====================
// Threshold for volume spike (currentVolume - rollingAverage) to detect a clap
const THRESHOLD = 0.05;

// Cooldown period in milliseconds to prevent double firing
const COOLDOWN = 1000;

// Minimum absolute volume to prevent false triggers in silence
const MIN_VOLUME = 0.02;

// Rolling average smoothing factor (0.0 to 1.0; lower = smoother adaptation)
const ROLLING_AVG_ALPHA = 0.05;
// ==============================================================

(() => {
  // Prevent duplicate execution if re-injected
  if (window.__meetSnapInjected) return;
  window.__meetSnapInjected = true;

  console.log('%c[MeetSnap v1.0.2] INITIALIZED - MAIN world script active', 'background: #007acc; color: white; font-size: 13px; font-weight: bold; padding: 3px 6px; border-radius: 3px;');

  // Visual state: toggles between red tint (true) and normal video (false)
  let isRedTintActive = true;

  // Track IDs that have already had a clap detector attached
  const attachedTrackIds = new Set();

  // Persistent reference to prevent V8 garbage collection of active WebAudio nodes
  const activeDetectors = [];

  /**
   * Attaches clap detection to an audio track once per track.
   * Clones the audio track so the stream Google Meet receives remains untouched.
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
      let rollingAverage = 0;
      let lastClapTime = 0;
      const pcmData = new Float32Array(analyser.fftSize);

      // Sample volume every 20ms
      const sampleInterval = setInterval(() => {
        if (!analyser) return;

        analyser.getFloatTimeDomainData(pcmData);

        // Calculate Root Mean Square (RMS) volume
        let sumSquares = 0;
        for (let i = 0; i < pcmData.length; i++) {
          const sample = pcmData[i];
          sumSquares += sample * sample;
        }
        const vol = Math.sqrt(sumSquares / pcmData.length);
        currentVolume = vol;

        // Update short rolling average
        if (rollingAverage === 0) {
          rollingAverage = vol;
        } else {
          rollingAverage = (1 - ROLLING_AVG_ALPHA) * rollingAverage + ROLLING_AVG_ALPHA * vol;
        }

        const spike = vol - rollingAverage;
        const now = Date.now();

        // Detect sudden volume spike exceeding THRESHOLD with COOLDOWN
        if (spike >= THRESHOLD && vol >= MIN_VOLUME && (now - lastClapTime >= COOLDOWN)) {
          lastClapTime = now;
          isRedTintActive = !isRedTintActive;
          console.log('[MeetSnap] CLAP detected, volume:', vol);
        }
      }, 20);

      // Every 1000ms log volume and threshold
      const logInterval = setInterval(() => {
        if (ctx && ctx.state !== 'closed') {
          console.log('[MeetSnap] volume:', currentVolume, 'threshold:', THRESHOLD);
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

    // Offscreen canvas for frame drawing and visual effect processing
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');

    // Initial frame fill
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let animId = null;

    // Render loop using requestAnimationFrame
    function renderLoop() {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const width = video.videoWidth;
        const height = video.videoHeight;

        if (width > 0 && height > 0) {
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }

          // Draw the camera video onto the offscreen canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // If red tint is active, apply overlay; otherwise normal video is displayed
          if (isRedTintActive) {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
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
