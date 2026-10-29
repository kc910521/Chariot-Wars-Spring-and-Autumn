// Exports the sound registry as one machine-readable file, so a port to another
// engine (Cocos, Godot, 小游戏) can be generated from the same data the game
// plays instead of from a second hand-written list.
//
//   node scripts/export-audio-manifest.mjs            # to stdout
//   node scripts/export-audio-manifest.mjs --out x.json
//
// Everything the manifest knows comes from src/data/sounds.js plus the WAV headers
// on disk: the cue a file plays, whether it loops, whether it is streamed, its
// mix row, and its length. An mp3's duration is left null because it is only
// known after a decode, and guessing it from the file size would put a wrong number
// into a build script.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeSoundFile, soundBorrowed, soundCues, soundDeathCues, soundFiles, soundLimits, soundMix,
  soundPurchaseCues, soundStreams,
} from "../src/data/sounds.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const soundRoot = join(projectRoot, "src/assets/sound");

// Total length of the PCM data chunk, in seconds. Null for a container that needs
// a decoder to measure.
function wavDuration(filePath) {
  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    return null;
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bits = buffer.readUInt16LE(offset + 22);
    }
    if (id === "data") {
      const frames = size / ((bits / 8) * channels);
      return { seconds: Number((frames / sampleRate).toFixed(3)), sampleRate, channels, bits };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

const out = process.argv.indexOf("--out");
const outPath = out >= 0 ? process.argv[out + 1] : null;

const streamed = new Set(soundStreams);
const banks = new Map();
for (const file of soundFiles) {
  const described = describeSoundFile(file);
  if (!banks.has(described.cue)) banks.set(described.cue, { described, files: [] });
  banks.get(described.cue).files.push(file);
}

const cues = [];
for (const [key, cue] of Object.entries(soundCues)) {
  const bank = banks.get(cue);
  if (!bank) throw new Error(`soundCues.${key} names "${cue}", which no file plays`);
  const mix = soundMix[key] ?? {};
  cues.push({
    key,
    cue,
    loop: bank.described.loop,
    streamed: bank.files.some((file) => streamed.has(file)),
    gain: mix.gain ?? soundLimits.gain,
    maxVoices: mix.maxVoices ?? soundLimits.maxVoices,
    minInterval: mix.minInterval ?? soundLimits.minInterval,
    files: bank.files.map((file) => {
      const absolute = join(soundRoot, file);
      const info = wavDuration(absolute);
      return {
        path: `src/assets/sound/${file}`,
        bytes: statSync(absolute).size,
        seconds: info?.seconds ?? null,
        sampleRate: info?.sampleRate ?? null,
        channels: info?.channels ?? null,
      };
    }),
  });
}

const manifest = {
  // The pipeline contract: every non-streamed file is exactly this, which is what
  // lets a port decode with no codec at all.
  format: { sampleRate: 22050, bits: 16, channels: 1, peakDbfs: -3, pipeline: "scripts/transcode-audio.mjs" },
  limits: { ...soundLimits },
  cues,
  // The events that are still borrowing a cue, so a port knows where a real drop
  // is still missing instead of inheriting the stand-in silently.
  borrowed: { ...soundBorrowed },
  deaths: { ...soundDeathCues },
  purchases: { ...soundPurchaseCues },
  totals: {
    files: soundFiles.length,
    bytes: cues.reduce((sum, cue) => sum + cue.files.reduce((inner, file) => inner + file.bytes, 0), 0),
    streamedBytes: soundFiles.filter((file) => streamed.has(file)).reduce((sum, file) => sum + statSync(join(soundRoot, file)).size, 0),
  },
};

const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (outPath) {
  writeFileSync(resolve(projectRoot, outPath), text);
  console.log(`[audio] wrote ${outPath}: ${cues.length} cues, ${manifest.totals.files} files, ${(manifest.totals.bytes / 1048576).toFixed(2)} MiB`);
} else {
  process.stdout.write(text);
}
