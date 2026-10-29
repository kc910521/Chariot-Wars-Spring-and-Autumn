// Audio asset pipeline. Turns the raw drops under src/assets/sound into the one
// format the browser engine can decode without a codec, on every platform
// (including 小游戏): 22.05 kHz / 16-bit / mono PCM WAV.
//
//   node scripts/transcode-audio.mjs [--dry-run] [--keep-loudness] [--levels]
//
// `--levels` is the audit counterpart and writes nothing: it decodes every file
// that ships - `ambient/` included, which the transcode walk deliberately skips -
// and prints peak and RMS for each, flagging whatever sits far below the rest of
// the set. The one folder this pipeline never rewrites is also the one it never
// looked at, and a silent music bed is a perfectly valid mp3: the field bed in the
// repo is an empty bounce that only a measurement catches.
//
// Why mono PCM and not mp3:
//   * `decodeAudioData` needs no codec, so there is no AAC/ogg gap between
//     Chrome, Firefox, Safari and 小游戏;
//   * PCM has no encoder padding, so a `_loop` cue repeats without a seam;
//   * mono halves the decoded memory, and these cues are all under 4.1s, so the
//     WAV file is no larger than the 320 kbps mp3 it replaces.
//
// Why the peak normalisation: the source drops were mastered at wildly different
// levels (a weapon hit sits at 0 dBFS, the retreat cue at -27 dBFS). Every file
// lands at -3 dBFS so that loudness lives in one reviewable table
// (`src/data/sounds.js`) instead of being baked into 31 separate recordings.
// The boost is capped so a quiet recording is not turned into amplified hiss.
//
// The originals are moved to `assets/audio-source/` (git-ignored), so re-running
// after a re-drop is always safe. Files that already are 22.05 kHz mono PCM are
// left alone, which makes the script idempotent.
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const soundRoot = join(projectRoot, "src/assets/sound");
const sourceRoot = join(projectRoot, "assets/audio-source");

const SAMPLE_RATE = 22050;
const TARGET_PEAK = 10 ** (-3 / 20); // -3 dBFS: headroom for 3-4 overlapping voices
const MAX_BOOST_DB = 12; // a quiet recording stays quiet instead of gaining hiss
// How far under the set's median RMS a shipped file may sit before `--levels` calls
// it out. 12 dB is generous: the spread across the 29 one-shots is about 21 dB
// end to end, so only something structurally wrong (an empty bounce, a wrong
// export) trips it.
const QUIET_WARN_DB = 12;
const SOURCE_EXTENSIONS = new Set([".wav", ".mp3"]);
// A `_loop` cue is restarted from its first sample the moment it ends, so a tail
// that does not sit at zero clicks. Neither source drop is zero-crossed, so every
// loop gets this fade at both edges; 8 ms is inaudible on a battle bed.
const LOOP_EDGE_FADE_SECONDS = 0.008;
const LOOP_NAME = /_loop\.[a-z0-9]+$/;

// Files that must not ship. Each entry states why, so the next person does not
// add it back by copying the raw drop again.
const dropped = new Map([
  ["player/victory_sounds.wav", "20.04s / 96 kHz jingle (11.5 MB); victory borrows a cue instead"],
]);

// Spelling fixes applied on the way through: the drop names are the routing keys
// (see src/data/sounds.js), so a typo would otherwise become part of the data
// contract forever.
const renames = new Map([
  ["player/foodstep_", "player/footstep_"],
  ["player/shoppage_equiptment_upgrade", "player/shoppage_equipment_upgrade"],
]);

const dryRun = process.argv.includes("--dry-run");
const keepLoudness = process.argv.includes("--keep-loudness");
// Re-transcode from the archived master even when the shipped file already is
// 22.05 kHz mono. Needed after a policy change (target peak, edge fade), which is
// exactly why the originals are kept.
const force = process.argv.includes("--force");
// Report-only mode: measure what ships, rewrite nothing.
const levelsOnly = process.argv.includes("--levels");

function listSources(dir, { streams = false } = {}) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `ambient/` is the one exception to the pipeline: two 30s music beds that
      // stream through an <audio> element, so their 48 kHz stereo mp3 stays as is.
      // The `--levels` audit still walks it: "not transcoded" must not mean
      // "not measured", which is how a silent bed shipped.
      if (entry.name === "ambient" && !streams) continue;
      found.push(...listSources(fullPath, { streams }));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) found.push(fullPath);
  }
  return found.sort();
}

function readWav(buffer) {
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = {
        tag: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bits: buffer.readUInt16LE(offset + 22),
      };
    } else if (id === "data") {
      data = buffer.subarray(offset + 8, offset + 8 + size);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || !data) throw new Error("not a RIFF/WAVE file");
  return { format, data };
}

// afconvert's own `-c 1` keeps channel 0 and throws channel 1 away, which
// audibly thins the few drops that really are stereo (wave_up is 3.3 dB louder on
// the right). Averaging here keeps both channels at equal weight.
function downmixToMono({ format, data }) {
  const frames = Math.floor(data.length / (2 * format.channels));
  const mono = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE((frame * format.channels + channel) * 2);
    }
    mono[frame] = sum / format.channels;
  }
  return mono;
}

function peakOf(samples) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function encodeMonoWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM format chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(samples[index])));
    buffer.writeInt16LE(clamped, 44 + index * 2);
  }
  return buffer;
}

function isAlreadyOptimised(filePath) {
  try {
    const { format } = readWav(readFileSync(filePath));
    return format.channels === 1 && format.sampleRate === SAMPLE_RATE && format.bits === 16;
  } catch {
    return false;
  }
}

// Peak and RMS of one shipped file, measured through the same CoreAudio decode the
// pipeline uses, so a mono 22.05 kHz wav and a 48 kHz stereo mp3 are compared on
// equal terms. Level is taken per channel sample, not on a downmix: averaging the
// two channels first would cancel anti-phase content and report a peak that is 6 dB
// shy of what the browser actually sends to the speakers. The scratch file goes to
// the OS temp dir, so an audit leaves no trace.
function measureLevels(filePath) {
  const scratch = join(tmpdir(), `chariot-levels-${process.pid}.wav`);
  try {
    execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "2", filePath, scratch]);
    const { format, data } = readWav(readFileSync(scratch));
    const frames = Math.floor(data.length / (2 * format.channels));
    const total = frames * format.channels;
    let peak = 0;
    let sumSquares = 0;
    for (let index = 0; index < total; index += 1) {
      const sample = data.readInt16LE(index * 2);
      peak = Math.max(peak, Math.abs(sample));
      sumSquares += sample * sample;
    }
    const rms = total > 0 ? Math.sqrt(sumSquares / total) : 0;
    return {
      seconds: frames / SAMPLE_RATE,
      peakDb: peak > 0 ? 20 * Math.log10(peak / 32768) : null,
      rmsDb: rms > 0 ? 20 * Math.log10(rms / 32768) : null,
    };
  } finally {
    rmSync(scratch, { force: true });
  }
}

// RMS is the number that matters here, not peak: a peak only says the loudest
// transient is there, while a bed of hiss can peak at -2 dBFS and still average
// -58. The median is over the whole set, so one outlier cannot hide inside it.
function reportLevels(files) {
  const measured = files.map((filePath) => ({
    name: relative(soundRoot, filePath).split("\\").join("/"),
    ...measureLevels(filePath),
  }));
  const sorted = measured.map((row) => row.rmsDb).filter((value) => value !== null).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const db = (value) => (value === null ? "-" : `${value.toFixed(1)} dBFS`);
  console.log(`${"file".padEnd(52)}${"seconds".padStart(9)}${"peak".padStart(11)}${"rms".padStart(11)}`);
  for (const row of measured) {
    console.log(
      `${row.name.padEnd(52)}${row.seconds.toFixed(2).padStart(9)}` +
        `${db(row.peakDb).padStart(11)}${db(row.rmsDb).padStart(11)}`,
    );
  }
  if (median === null) return;
  const quiet = measured.filter((row) => row.rmsDb !== null && row.rmsDb < median - QUIET_WARN_DB);
  console.log(
    `\n${measured.length} files, median rms ${median.toFixed(1)} dBFS, ` +
      `${quiet.length} more than ${QUIET_WARN_DB} dB under it`,
  );
  for (const row of quiet) {
    console.log(
      `  ${row.name}  rms ${row.rmsDb.toFixed(1)} dBFS (${(row.rmsDb - median).toFixed(1)} dB):` +
        " a cue or bed this far under the rest is inaudible in game",
    );
  }
}

function archiveName(relativePath) {
  return relativePath.split("/").join("_");
}

function archive(filePath, relativePath) {
  const target = join(sourceRoot, archiveName(relativePath));
  if (!existsSync(target)) copyFileSync(filePath, target);
}

function renamedPath(filePath) {
  const relativePath = relative(soundRoot, filePath).split("\\").join("/");
  for (const [from, to] of renames) {
    if (relativePath.startsWith(from)) return join(soundRoot, `${to}${relativePath.slice(from.length)}`);
  }
  return filePath;
}

// The archived master for a shipped file, following the rename table backwards
// (a renamed drop is archived under the name it arrived with). The shipped file
// is always .wav while the master may be the original .mp3, so both are tried.
function originalFor(relativePath) {
  const bases = [relativePath];
  for (const [from, to] of renames) {
    if (relativePath.startsWith(to)) bases.push(`${from}${relativePath.slice(to.length)}`);
  }
  const names = bases.flatMap((base) => [".mp3", ".wav"].map((ext) => archiveName(base.replace(/\.[a-z0-9]+$/, ext))));
  return names.map((name) => join(sourceRoot, name)).find((path) => existsSync(path)) ?? null;
}

function applyEdgeFade(samples, sampleRate) {
  const fade = Math.min(Math.floor(sampleRate * LOOP_EDGE_FADE_SECONDS), Math.floor(samples.length / 2));
  for (let index = 0; index < fade; index += 1) {
    const gain = index / fade;
    samples[index] *= gain;
    samples[samples.length - 1 - index] *= gain;
  }
}

const rows = [];
let alreadyDone = 0;

// `--levels` is an audit: the walk gets an empty list, so no file is transcoded,
// archived or removed by a measurement.
const files = listSources(soundRoot, { streams: levelsOnly });

if (!dryRun && !levelsOnly) mkdirSync(sourceRoot, { recursive: true });

for (const filePath of levelsOnly ? [] : files) {
  const relativePath = relative(soundRoot, filePath).split("\\").join("/");
  const before = statSync(filePath).size;

  const dropReason = dropped.get(relativePath);
  if (dropReason) {
    if (!dryRun) {
      archive(filePath, relativePath);
      rmSync(filePath);
    }
    rows.push({ name: relativePath, before, after: 0, peakDb: null, gainDb: null, note: `dropped - ${dropReason}` });
    continue;
  }

  const optimised = isAlreadyOptimised(filePath);
  const archivedInput = optimised && force ? originalFor(relativePath) : null;
  if (optimised && !archivedInput) {
    alreadyDone += 1;
    continue;
  }
  const inputPath = archivedInput ?? filePath;
  if (archivedInput) console.log(`${relativePath}: re-reading the archived master`);

  const targetPath = renamedPath(filePath).replace(extname(filePath), ".wav");
  const targetRelative = relative(soundRoot, targetPath).split("\\").join("/");
  if (dryRun) {
    rows.push({ name: targetRelative, before, after: 0, peakDb: null, gainDb: null, note: "dry run" });
    continue;
  }

  // 1. Let CoreAudio decode + resample into a stereo PCM scratch file, so mp3 and
  //    wav sources take the same path and both channels survive the trip.
  const scratch = join(sourceRoot, `.scratch-${process.pid}.wav`);
  execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "2", inputPath, scratch]);

  // 2. Average to mono, normalise the peak, seal the loop edges, write it out.
  const samples = downmixToMono(readWav(readFileSync(scratch)));
  const sourcePeak = peakOf(samples);
  const wanted = sourcePeak > 0 ? (TARGET_PEAK * 32768) / sourcePeak : 1;
  const gain = keepLoudness ? 1 : Math.min(wanted, 10 ** (MAX_BOOST_DB / 20));
  for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
  const isLoop = LOOP_NAME.test(targetPath);
  if (isLoop) applyEdgeFade(samples, SAMPLE_RATE);
  writeFileSync(targetPath, encodeMonoWav(samples, SAMPLE_RATE));

  // 3. Archive the original (before any rename moves it) and clean up.
  if (!optimised) archive(filePath, relativePath);
  rmSync(scratch);
  if (targetPath !== filePath) rmSync(filePath);

  rows.push({
    name: targetRelative,
    before,
    after: statSync(targetPath).size,
    peakDb: sourcePeak > 0 ? 20 * Math.log10(sourcePeak / 32768) : null,
    gainDb: sourcePeak > 0 ? 20 * Math.log10(gain) : null,
    note: isLoop ? "22.05 kHz mono, loop edge fade" : "22.05 kHz mono",
  });
}

if (levelsOnly) {
  reportLevels(files);
} else {
  const totalBefore = rows.reduce((sum, row) => sum + row.before, 0);
  const totalAfter = rows.reduce((sum, row) => sum + row.after, 0);
  for (const row of rows) {
    const peak = row.peakDb === null ? "-" : `${row.peakDb.toFixed(1)} dBFS`;
    const gain = row.gainDb === null ? "-" : `${row.gainDb > 0 ? "+" : ""}${row.gainDb.toFixed(1)} dB`;
    console.log(
      `${row.name.padEnd(46)}${String(row.before).padStart(9)} -> ${String(row.after).padStart(7)}` +
        `  peak ${peak.padStart(9)}  gain ${gain.padStart(7)}  ${row.note}`,
    );
  }
  console.log(
    `\n${rows.length} files, ${alreadyDone} already 22.05 kHz mono` +
      `\n${(totalBefore / 1048576).toFixed(2)} MiB -> ${(totalAfter / 1048576).toFixed(2)} MiB` +
      `\noriginals archived in ${relative(projectRoot, sourceRoot)}/`,
  );
}
