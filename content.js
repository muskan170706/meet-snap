/**
 * MeetSnap - Google Meet Camera Stream Interceptor
 * Injected in MAIN world at document_start.
 */

(() => {
  // Prevent duplicate execution if re-injected
  if (window.__meetSnapInjected) return;
  window.__meetSnapInjected = true;

  console.log('[MeetSnap] Content script running in MAIN world at document_start.');

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

    // If request has no video, pass it through unchanged
    const hasVideo = Boolean(constraints && constraints.video);
    if (!hasVideo) {
      console.log('[MeetSnap] Audio-only or no-video request. Passing through unchanged.');
      return originalGetUserMedia.call(navigator.mediaDevices, constraints);
    }

    // Call the original getUserMedia to acquire real camera + microphone stream
    const realStream = await originalGetUserMedia.call(navigator.mediaDevices, constraints);
    const videoTracks = realStream.getVideoTracks();

    // If no video track was returned, return the stream as-is
    if (videoTracks.length === 0) {
      console.log('[MeetSnap] No video track returned in real stream. Passing through.');
      return realStream;
    }

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

          // Apply a RED TINT overlay to verify interception works
          ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
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

    // Cleanup helper
    function cleanup() {
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
      cleanup();
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
    const originalAudioTracks = realStream.getAudioTracks();
    const interceptedStream = new MediaStream([canvasVideoTrack, ...originalAudioTracks]);

    console.log('[MeetSnap] Interception active: returning canvas stream with original audio.');
    return interceptedStream;
  }

  // Override on both navigator.mediaDevices and prototype for maximum reliability
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = interceptedGetUserMedia;
  }
  if (window.MediaDevices && MediaDevices.prototype) {
    MediaDevices.prototype.getUserMedia = interceptedGetUserMedia;
  }

  console.log('[MeetSnap] navigator.mediaDevices.getUserMedia successfully intercepted.');
})();
