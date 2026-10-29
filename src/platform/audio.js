// Audio device facade: the only file in the project that names the Web Audio API
// or an <audio> element. Everything above it (src/assets/audio.js) deals in cues,
// gains and lanes, so a mini-game host can implement the same handful of methods
// on top of InnerAudioContext without touching a line of game code.
//
// Device contract - every method is best-effort and never throws:
//   available            bool: a context exists and can decode
//   unlock()             resume after the first user gesture (autoplay policy)
//   decode(url)          Promise<AudioBuffer|null>, cached by url
//   startBuffer(buffer, { gain, loop, fadeIn }) -> voice|null
//   startStream(url, { gain })                  -> stream|null
//   resumeStream(stream) -> bool: re-issue play() refused by the autoplay policy
//   streamState(stream)  -> { paused, at, volume }: is it actually sounding?
//   stopVoice(voice, fade) / stopStream(stream, fade)
//   setVoiceGain(voice, gain, ramp) / setStreamGain(stream, gain, ramp)
//   now()                seconds on the context clock, for rate limiting
//
// Two platform facts shape the shape of this file. A context may only be created
// or resumed inside a user gesture, so it is built lazily and `unlock()` is what a
// first tap calls. And `decodeAudioData` needs a codec for whatever format it is
// handed, which is why the assets are PCM WAV (scripts/transcode-audio.mjs): a
// host that has no decoder stays silent instead of throwing on the first shot.
function audioContextCtor() {
  const scope = globalThis.window ?? globalThis;
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function audioElementCtor() {
  const scope = globalThis.window ?? globalThis;
  return scope.Audio ?? scope.HTMLAudioElement ?? null;
}

function warn(action, error) {
  console.warn(`[chariot-wars] audio ${action} failed`, error);
}

export function createAudioDevice({ onError = warn } = {}) {
  const contextCtor = audioContextCtor();
  const elementCtor = audioElementCtor();
  let context = null;
  let attempted = false;
  const decoded = new Map();

  function buildContext() {
    if (context || attempted) return context;
    attempted = true;
    if (!contextCtor) return null;
    try {
      context = new contextCtor();
    } catch (error) {
      onError("context", error);
      context = null;
    }
    return context;
  }

  const canDecode = () => typeof buildContext()?.decodeAudioData === "function"
    && typeof context.createBufferSource === "function";

  // The context clock is what a rate limiter has to compare against: it stops
  // while the tab is suspended, so a cue fired before a background tab does not
  // come back with a timestamp from the future and mute the return.
  function now() {
    if (context && typeof context.currentTime === "number") return context.currentTime;
    return (globalThis.performance?.now?.() ?? Date.now()) / 1000;
  }

  function unlock() {
    const built = buildContext();
    if (built && built.state === "suspended" && typeof built.resume === "function") {
      // A rejected resume is the normal answer to a call outside a gesture; the
      // next one (a real tap) succeeds.
      built.resume().catch(() => {});
    }
  }

  function decode(url) {
    if (!canDecode()) return Promise.resolve(null);
    const cached = decoded.get(url);
    if (cached) return cached;
    const pending = (globalThis.fetch ? globalThis.fetch(url) : Promise.reject(new Error("no fetch")))
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} for ${url}`);
        return response.arrayBuffer();
      })
      .then((bytes) => new Promise((resolve, reject) => {
        // The callback form rather than the promise form: the promise form is
        // missing on older Safari builds.
        context.decodeAudioData(bytes, resolve, reject);
      }))
      .catch((error) => {
        onError(`decode ${url}`, error);
        // Cached as a miss so a broken file is not refetched on every shot.
        decoded.set(url, Promise.resolve(null));
        return null;
      });
    decoded.set(url, pending);
    return pending;
  }

  function startBuffer(buffer, { gain = 1, loop = false, fadeIn = 0 } = {}) {
    if (!buffer || !canDecode()) return null;
    try {
      const source = context.createBufferSource();
      const gainNode = context.createGain();
      source.buffer = buffer;
      source.loop = loop;
      gainNode.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : gain, now());
      if (fadeIn > 0 && typeof gainNode.gain.linearRampToValueAtTime === "function") {
        gainNode.gain.linearRampToValueAtTime(gain, now() + fadeIn);
      }
      source.connect(gainNode);
      gainNode.connect(context.destination);
      source.start();
      return { source, gainNode, gain };
    } catch (error) {
      onError("startBuffer", error);
      return null;
    }
  }

  function stopVoice(voice, fade = 0) {
    if (!voice) return;
    try {
      if (fade > 0 && typeof voice.gainNode.gain.linearRampToValueAtTime === "function") {
        voice.gainNode.gain.setValueAtTime(voice.gain, now());
        voice.gainNode.gain.linearRampToValueAtTime(0.0001, now() + fade);
        voice.source.stop(now() + fade + 0.02);
        return;
      }
      voice.source.stop();
    } catch {
      // Already stopped (a loop that ended, a double release): not worth a console
      // line, and never worth a crash mid-battle.
    }
  }

  function setVoiceGain(voice, gain, ramp = 0) {
    if (!voice) return;
    try {
      const param = voice.gainNode.gain;
      if (ramp > 0 && typeof param.linearRampToValueAtTime === "function") {
        param.setValueAtTime(voice.gain, now());
        param.linearRampToValueAtTime(gain, now() + ramp);
      } else {
        param.setValueAtTime(gain, now());
      }
      voice.gain = gain;
    } catch (error) {
      onError("setVoiceGain", error);
    }
  }

  function startStream(url, { gain = 1 } = {}) {
    if (!elementCtor) return null;
    try {
      const element = new elementCtor();
      element.src = url;
      element.loop = true;
      element.volume = 0;
      element.preload = "auto";
      const playing = element.play();
      // A refused `play()` (no gesture yet) is expected: the element stays wired,
      // so the next gain or unlock picks it up. Chromium returns a promise, older
      // Safari returns undefined.
      if (playing && typeof playing.catch === "function") playing.catch(() => {});
      return { element, gain, volume: 0, timer: null };
    } catch (error) {
      onError("startStream", error);
      return null;
    }
  }

  // An element's volume is a plain number, not an AudioParam, so a fade has to be
  // stepped. 12 ms is under a frame at 60 Hz, which is fine for a music bed:
  // nobody hears the stairs in a 1.2 s crossfade.
  function rampStream(stream, to, seconds) {
    if (stream.timer !== null) {
      clearInterval(stream.timer);
      stream.timer = null;
    }
    if (!(seconds > 0) || typeof setInterval !== "function") {
      stream.volume = to;
      stream.element.volume = to;
      return;
    }
    const from = stream.volume;
    const steps = Math.max(1, Math.round(seconds / 0.012));
    let step = 0;
    stream.timer = setInterval(() => {
      step += 1;
      const ratio = Math.min(1, step / steps);
      stream.volume = from + (to - from) * ratio;
      try {
        stream.element.volume = Math.max(0, Math.min(1, stream.volume));
      } catch {
        // A host that refuses a volume write keeps the last one it accepted.
      }
      if (ratio >= 1) {
        clearInterval(stream.timer);
        stream.timer = null;
      }
    }, 12);
  }

  function setStreamGain(stream, gain, ramp = 0) {
    if (!stream) return;
    stream.gain = gain;
    rampStream(stream, Math.max(0, Math.min(1, gain)), ramp);
  }

  function stopStream(stream, fade = 0) {
    if (!stream) return;
    if (stream.timer !== null) {
      clearInterval(stream.timer);
      stream.timer = null;
    }
    if (fade <= 0) {
      try {
        stream.element.pause();
      } catch {
        // Nothing to pause on a host that never started the element.
      }
      return;
    }
    rampStream(stream, 0, fade);
    // The element is paused once the fade has run, not before: a paused element
    // makes no sound at all, so pausing first would cut the fade off.
    if (typeof setTimeout === "function") {
      setTimeout(() => {
        try {
          stream.element.pause();
        } catch {
          // See above.
        }
      }, fade * 1000 + 40);
    }
  }

  // A stream opened before the first gesture had its `play()` refused (see
  // startStream) and stays paused until something asks again. Resuming is the
  // narrow fix: re-issue `play()` and put back the gain the caller already asked
  // for, without touching the element's position. A stop/start would do the same
  // job by tearing the element down, which restarts a 30s bed from 0:00 every time
  // the player taps the screen.
  function resumeStream(stream) {
    if (!stream?.element) return false;
    const { element } = stream;
    try {
      if (element.paused !== false) {
        const playing = element.play();
        // The same two answers as startStream: a promise on Chromium, undefined on
        // older Safari, and a refusal outside a gesture is not an error.
        if (playing && typeof playing.catch === "function") playing.catch(() => {});
      }
      // An element that never got its fade (the refusal can land before the first
      // step) would come back at volume 0. `rampStream` also cancels a stale timer.
      rampStream(stream, Math.max(0, Math.min(1, stream.gain ?? 0)), 0);
      return element.paused !== true;
    } catch (error) {
      onError("resumeStream", error);
      return false;
    }
  }

  // Read-only state, for the audio lab and the harnesses. `paused` is the one fact
  // the player cannot infer from its own bookkeeping: the autoplay policy changes
  // it behind our back, and a refused bed is otherwise indistinguishable from a
  // playlist that is playing fine.
  function streamState(stream) {
    const element = stream?.element;
    if (!element) return { paused: true, at: 0, volume: 0 };
    return {
      paused: element.paused !== false,
      at: typeof element.currentTime === "number" ? element.currentTime : 0,
      volume: typeof element.volume === "number" ? element.volume : stream.volume ?? 0,
    };
  }

  return {
    get available() {
      return canDecode();
    },
    get hasStreams() {
      return Boolean(elementCtor);
    },
    unlock,
    decode,
    startBuffer,
    stopVoice,
    setVoiceGain,
    startStream,
    stopStream,
    resumeStream,
    streamState,
    setStreamGain,
    now,
  };
}
