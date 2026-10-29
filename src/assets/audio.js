// The sound player: cues in, sound out. It owns the decisions - which take, how
// loud, how often, which loop lane - and asks src/platform/audio.js for the two
// mechanisms it has (decoded buffers and streaming elements). Nothing here names
// Web Audio, an <audio> element or a file path.
//
// Five methods are the whole surface:
//   play(cue, options?)               fire a one-shot cue from src/data/sounds.js
//   setState({ mode, boss, moving })  what is on screen, which drives the loops
//   stop(lane?)                       silence one loop lane, or all of them
//   setEnabled(flag)                  the mute switch (state.sound is watched too)
//   unlock()                          call from a user gesture, to start playback
//
// Three rules make it safe to call `play()` from anywhere in the simulation:
//   * a cue with no bank, or a host with no decoder, is silent - never an error;
//   * the same cue is rate limited (`minInterval`) and voice limited
//     (`maxVoices`, plus the global ceiling), so a volley of twelve arrows cannot
//     turn into one loud smear;
//   * the take is picked round-robin and never from `campaign.random()`, so
//     adding a sound cannot change what a seeded battle does.
import {
  describeSoundFile, resolveSoundscape, soundChannels, soundCues, soundFiles, soundLimits, soundMix,
  soundStreams,
} from "../data/sounds.js";
import { createAudioDevice } from "../platform/audio.js";

// cue id -> the takes that play it. `files` is a plain list so the unit test can
// assert the registry covers every file without touching the browser.
export function indexSoundFiles(files = soundFiles, streams = soundStreams) {
  const streamed = new Set(streams);
  const banks = new Map();
  for (const file of files) {
    const { cue, loop } = describeSoundFile(file);
    if (!banks.has(cue)) banks.set(cue, { cue, files: [], loop, stream: streamed.has(file) });
    banks.get(cue).files.push(file);
  }
  return banks;
}

// The mix table is keyed by the semantic name (`chariotArrow`) because that is how
// a balance decision is discussed; the engine indexes it by cue id, because that
// is what gameplay hands to play(). Built once per player, not per shot.
export function buildMixTable(cues = soundCues, mix = soundMix) {
  const table = new Map();
  for (const [key, cue] of Object.entries(cues)) if (mix[key]) table.set(cue, mix[key]);
  return table;
}

export function createAudio(state = null, {
  device = createAudioDevice(), files = soundFiles, streams = soundStreams,
} = {}) {
  const banks = indexSoundFiles(files, streams);
  const mixTable = buildMixTable();
  const voices = new Map(); // cue id -> [{ voice, endsAt }]
  const lastPlayed = new Map(); // cue id -> device time
  const cursors = new Map(); // cue id -> next take index
  const tracks = new Map(); // lane -> { cue, handle, kind }
  const unknown = new Set();
  let enabled = true;
  let sceneKey = "";
  let sceneLayers = {};
  let warmed = false;
  let lastMuted = false;

  // Two mute switches, not one: `state.sound` is what the HUD toggle writes, and
  // `setEnabled` is what a host (the mini-game, a test) calls. Either one off is
  // silence, so neither can be forgotten by the other.
  const muted = () => !enabled || state?.sound === false;

  // The mix row for a cue id, or an empty row so every caller can read
  // `gain`/`maxVoices`/`minInterval` without its own fallback chain.
  const mixFor = (cue) => mixTable.get(cue) ?? {};

  // `import.meta.url` makes the path independent of the page that booted the game
  // (index.html, a harness, a sub-directory build). A host without module meta
  // falls back to the path the static server serves the assets from.
  function soundUrl(file) {
    const base = import.meta?.url;
    if (!base) return `src/assets/sound/${file}`;
    return new URL(`./sound/${file}`, base).href;
  }

  function warnOnce(cue) {
    if (unknown.has(cue)) return;
    unknown.add(cue);
    console.warn(`[chariot-wars] no sound is registered for the cue "${cue}"`);
  }

  function pruneVoices(cue, time) {
    const list = voices.get(cue);
    if (!list) return [];
    const live = list.filter((entry) => entry.endsAt > time);
    if (live.length === 0) voices.delete(cue);
    else if (live.length !== list.length) voices.set(cue, live);
    return live;
  }

  function liveVoiceCount(time) {
    let total = 0;
    for (const cue of [...voices.keys()]) total += pruneVoices(cue, time).length;
    return total;
  }

  // Decode-and-fire one take. The decode promise is returned so a test can await
  // the shot; gameplay ignores it, because a slow decode must never stall a frame.
  function startOneShot(cue, gain, time) {
    const bank = banks.get(cue);
    if (!bank || bank.loop) return null;
    const index = (cursors.get(cue) ?? 0) % bank.files.length;
    cursors.set(cue, index + 1);
    lastPlayed.set(cue, time);
    return device.decode(soundUrl(bank.files[index])).then((buffer) => {
      if (!buffer) return null;
      const voice = device.startBuffer(buffer, { gain });
      if (!voice) return null;
      const list = voices.get(cue) ?? [];
      // The buffer's own duration is what frees the slot: no timer, and a voice cut
      // by the mute switch is dropped by the next prune.
      list.push({ voice, endsAt: device.now() + buffer.duration });
      voices.set(cue, list);
      return voice;
    });
  }

  function play(cue, { gain = null } = {}) {
    if (!cue || muted()) return null;
    // Every event fired by hand is also a chance to hand back a bed the autoplay
    // policy refused. It matters because a lane can open on a mode change that no
    // tap follows (Safari refuses `play()` there and never retries by itself), and
    // the first shot or footstep after that is what brings the music back.
    resumeStreams();
    const bank = banks.get(cue);
    if (!bank) {
      warnOnce(cue);
      return null;
    }
    const mix = mixFor(cue);
    const time = device.now();
    const previous = lastPlayed.get(cue);
    if (previous !== undefined && time - previous < (mix.minInterval ?? soundLimits.minInterval)) return null;
    if (pruneVoices(cue, time).length >= (mix.maxVoices ?? soundLimits.maxVoices)) return null;
    if (liveVoiceCount(time) >= soundLimits.voices) return null;
    return startOneShot(cue, gain ?? mix.gain ?? soundLimits.gain, time);
  }

  // Warm-up: one file at a time, so decoding 29 drops never competes with the
  // first battle frame. Called from unlock(); a no-op on a host without a decoder.
  function warm() {
    if (warmed || !device.available) return;
    warmed = true;
    const queue = [...banks.values()].filter((bank) => !bank.stream).flatMap((bank) => bank.files);
    let chain = Promise.resolve();
    for (const file of queue) chain = chain.then(() => device.decode(soundUrl(file)));
  }

  // Loop lanes. A lane holds at most one loop, so a soundscape change is a diff:
  // a lane whose cue stayed keeps playing (that is why walking into a boss fight
  // does not cut the chariot's roll), a lane whose cue changed is crossfaded.
  function laneFade(lane, fallback = 0.2) {
    return soundChannels[lane]?.fadeSeconds ?? fallback;
  }

  function stopTrack(lane, fade = 0) {
    const track = tracks.get(lane);
    if (!track) return;
    tracks.delete(lane);
    if (track.kind === "stream") device.stopStream(track.handle, fade);
    else device.stopVoice(track.handle, fade);
  }

  function startTrack(lane, cue) {
    const bank = banks.get(cue);
    if (!bank || !bank.loop) {
      warnOnce(cue);
      return;
    }
    const mix = mixFor(cue);
    const fade = laneFade(lane);
    if (bank.stream) {
      if (!device.hasStreams) return;
      const handle = device.startStream(soundUrl(bank.files[0]), { gain: 0 });
      if (!handle) return;
      tracks.set(lane, { cue, handle, kind: "stream" });
      device.setStreamGain(handle, mix.gain ?? soundLimits.gain, fade);
      return;
    }
    // The handle arrives asynchronously, so a lane that changed its mind while the
    // buffer was decoding must not start on top of the take that replaced it.
    device.decode(soundUrl(bank.files[0])).then((buffer) => {
      if (!buffer || tracks.has(lane) || muted() || sceneLayers[lane] !== cue) return;
      const handle = device.startBuffer(buffer, {
        gain: mix.gain ?? soundLimits.gain, loop: true, fadeIn: fade,
      });
      if (handle) tracks.set(lane, { cue, handle, kind: "buffer" });
    });
  }

  function stopAll(fade = 0) {
    for (const lane of [...tracks.keys()]) stopTrack(lane, fade);
  }

  function applyLayers(layers) {
    sceneLayers = layers;
    if (muted()) {
      stopAll(0.15);
      return;
    }
    for (const lane of [...tracks.keys()]) {
      if (!(lane in layers)) stopTrack(lane, laneFade(lane));
    }
    for (const [lane, cue] of Object.entries(layers)) {
      const track = tracks.get(lane);
      if (track && track.cue === cue) continue;
      if (track) stopTrack(lane, laneFade(lane));
      startTrack(lane, cue);
    }
  }

  function setState(next = {}) {
    const { name, layers } = resolveSoundscape(next);
    const key = `${name}|${Object.keys(layers).sort().map((lane) => `${lane}=${layers[lane]}`).join(",")}`;
    const nowMuted = muted();
    // The battle loop calls this every frame, so the common answer has to be the
    // cheap one: an unchanged scene and an unchanged mute state do nothing.
    if (key === sceneKey && nowMuted === lastMuted) return;
    sceneKey = key;
    lastMuted = nowMuted;
    applyLayers(layers);
  }

  function setEnabled(value) {
    const next = value !== false;
    if (next === enabled) return;
    enabled = next;
    lastMuted = muted();
    // Applied now, not on the next frame: the HUD toggle can be pressed on the
    // shop page or the menu, which have their own clocks and never call setState.
    applyLayers(sceneLayers);
  }

  function stop(lane) {
    if (lane) {
      stopTrack(lane, laneFade(lane));
      return;
    }
    stopAll(0.15);
    // Silence until the next scene is announced, even an unchanged one: a caller
    // that stops everything and then asks for the same screen again means it, so
    // the scene key must not swallow the second call.
    sceneKey = "";
  }

  // A stream lane that opened before the first gesture had its `play()` refused and
  // is still paused. Resuming in place keeps the bed's position, so unlocking in the
  // middle of a battle does not restart the music from 0:00; only a lane the policy
  // actually paused is touched, which is what makes this cheap enough to call on
  // every unlock and every one-shot.
  function resumeStreams() {
    if (!device.hasStreams) return;
    for (const track of tracks.values()) {
      if (track.kind !== "stream") continue;
      if (!device.streamState(track.handle).paused) continue;
      device.resumeStream(track.handle);
    }
  }

  function unlock() {
    device.unlock();
    warm();
    resumeStreams();
  }

  return {
    play,
    setState,
    stop,
    setEnabled,
    unlock,
    // Read-only diagnostics for the harnesses and the audio lab page: which lanes
    // are sounding and how many one-shots are in flight. Gameplay never needs them.
    lanes: () => [...tracks.keys()],
    voices: () => liveVoiceCount(device.now()),
    // The same lanes with what the browser is really doing: `paused` is the one fact
    // the player cannot know on its own, and a refused music bed is silent in exactly
    // the way a working one is. Only ever read by tooling.
    inspect: () => [...tracks].map(([lane, track]) => {
      const mix = mixFor(track.cue);
      const status = track.kind === "stream"
        ? device.streamState(track.handle)
        : { paused: false, at: null, volume: mix.gain ?? soundLimits.gain };
      return {
        lane, cue: track.cue, kind: track.kind, paused: status.paused,
        volume: Math.round(status.volume * 1000) / 1000,
        at: status.at === null ? null : Math.round(status.at * 10) / 10,
      };
    }),
  };
}
