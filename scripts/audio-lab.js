// The audio lab: every cue and every drop in the shipping registry, playable, so a
// balance decision or a substitute can be made by ear instead of by reading file
// names. Open it through the static server: `node scripts/serve.mjs` then
// http://localhost:8000/scripts/audio-lab.html
//
// It plays through the real player (src/assets/audio.js), not a second
// implementation: what you hear here is what the game hears, gains and rate
// limiting included.
import {
  describeSoundFile, soundBorrowed, soundCues, soundFiles, soundMix, soundStreams,
} from "../src/data/sounds.js";
import { createAudio } from "../src/assets/audio.js";

const state = { sound: true };
const audio = createAudio(state);
const out = document.getElementById("out");
const status = document.getElementById("state");

// One listener for the whole page: browsers only start a context inside a gesture,
// so the first click anywhere is the unlock (and the warm-up decode).
document.addEventListener("pointerdown", () => audio.unlock(), { once: true });

const fileUrl = (file) => new URL(`../src/assets/sound/${file}`, import.meta.url).href;
let raw = null;

// Loop cues are not one-shots, so the player's play() refuses them by design (their
// length is owned by a lane, not by a tap). The lab auditions them through an
// element of its own, which is also how a streamed bed is heard.
function playRaw(file, { loop = false } = {}) {
  raw?.pause();
  raw = new Audio(fileUrl(file));
  raw.loop = loop;
  raw.play().catch((error) => { status.textContent = `播放失败：${error.message}`; });
  status.textContent = `${loop ? "循环" : "原始"}播放 ${file}`;
}

function cell(value) {
  const td = document.createElement("td");
  if (value instanceof Node) td.append(value);
  else td.textContent = value ?? "";
  return td;
}

function row(cells, className = "") {
  const tr = document.createElement("tr");
  if (className) tr.className = className;
  for (const value of cells) tr.append(cell(value));
  return tr;
}

function button(label, onClick, title = "") {
  const element = document.createElement("button");
  element.textContent = label;
  if (title) element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

function section(title, note) {
  const heading = document.createElement("h2");
  heading.textContent = title;
  out.append(heading);
  if (note) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = note;
    out.append(hint);
  }
  const table = document.createElement("table");
  out.append(table);
  return table;
}

function headers(table, labels) {
  const tr = document.createElement("tr");
  for (const label of labels) {
    const th = document.createElement("th");
    th.textContent = label;
    tr.append(th);
  }
  table.append(tr);
}

// 0. The lanes: what is sounding, and whether the browser is letting it. A music
// bed refused by the autoplay policy is silent in exactly the way a working one is,
// so this is the only place the difference is visible.
const laneTable = section(
  "Lanes · 正在响的声道",
  "「paused」是浏览器没让播（自动播放策略），不是文件缺失：点一下页面任意处或「解锁 / 恢复」，位置不会回到 0:00。",
);
headers(laneTable, ["声道", "cue", "类型", "状态", "音量", "位置"]);

function paintLanes() {
  for (const tr of [...laneTable.querySelectorAll("tr.lane")]) tr.remove();
  const rows = audio.inspect();
  if (rows.length === 0) {
    laneTable.append(row(["—", "没有声道在响", "", "", "", ""], "lane"));
    return;
  }
  for (const entry of rows) {
    laneTable.append(row([
      entry.lane,
      entry.cue,
      entry.kind,
      entry.paused ? "paused（未解锁）" : "playing",
      String(entry.volume),
      entry.at === null ? "—" : `${entry.at.toFixed(1)}s`,
    ], entry.paused ? "lane bad" : "lane"));
  }
}

// 1. The cues: what the game asks for, with the balance row that governs it.
const cueTable = section(
  "Cues · 游戏里能响的每一个事件",
  "点两下只听到一声是正常的：minInterval 就是为此存在。黄底的是 soundBorrowed 里借来的事件。",
);
headers(cueTable, ["cue", "文件", "音量", "最多同时", "最小间隔", ""]);

const borrowedInto = new Map();
for (const [event, cue] of Object.entries(soundBorrowed)) {
  borrowedInto.set(cue, [...(borrowedInto.get(cue) ?? []), event]);
}

for (const [key, cue] of Object.entries(soundCues)) {
  const mix = soundMix[key] ?? {};
  const takes = soundFiles.filter((file) => describeSoundFile(file).cue === cue);
  // A cue with no file is a registry bug the unit test catches; the page skips the
  // row rather than throwing and leaving the whole lab blank.
  if (takes.length === 0) continue;
  const borrowed = borrowedInto.get(cue) ?? [];
  const isLoop = describeSoundFile(takes[0]).loop;
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = key;
  name.title = cue;
  cueTable.append(row([
    name,
    `${cue} × ${takes.length}`,
    String(mix.gain ?? "默认"),
    String(mix.maxVoices ?? "默认"),
    mix.minInterval === undefined ? "无" : `${Math.round(mix.minInterval * 1000)} ms`,
    button(isLoop ? "循环" : "▶", () => {
      if (isLoop) {
        playRaw(takes[0], { loop: true });
        status.textContent = `${key} → ${cue}（循环）；游戏里由 ${borrowed.length ? "借用方" : "场景"} 控制起停`;
        return;
      }
      audio.play(cue);
      status.textContent = `${key} → ${cue}${borrowed.length ? `（借给 ${borrowed.join(" / ")}）` : ""}`;
    }),
  ], borrowed.length ? "borrowed" : ""));
}

// 2. The files: one row per drop, so a take can be compared against its siblings.
const fileTable = section(
  "Files · 每一个文件",
  "「▶」走游戏的混音；「原始」是文件的真实音量，用来判断两个文件是不是同一个声音。",
);
headers(fileTable, ["文件", "cue", "版本", "类型", "", ""]);

const streamed = new Set(soundStreams);
for (const file of soundFiles) {
  const { cue, variant, loop } = describeSoundFile(file);
  fileTable.append(row([
    file,
    cue,
    variant === 0 ? "—" : `${variant} / ${soundFiles.filter((other) => describeSoundFile(other).cue === cue).length}`,
    loop ? (streamed.has(file) ? "loop · 流" : "loop · 缓冲") : "一次性",
    loop
      ? button("循环", () => playRaw(file, { loop: true }), "以元素循环播放，与游戏里的声道同一条文件")
      : button("▶", () => {
        audio.play(cue);
        status.textContent = `${cue}（版本由轮转决定，见上表）`;
      }, "按混音播放这个 cue"),
    button("原始", () => playRaw(file), "直接播放这个文件的一次"),
  ]));
}

document.getElementById("stop").addEventListener("click", () => {
  audio.stop();
  raw?.pause();
  paintLanes();
  status.textContent = "已停止所有循环与原始播放";
});

document.getElementById("unlock").addEventListener("click", () => {
  audio.unlock();
  paintLanes();
  status.textContent = "已解锁：上表 Status 为 playing 才算真的在响";
});

// A bed is a lane, not a tap: the only way to hear one is to announce a scene, which
// is exactly what the game does every frame. These are the four the registry knows.
const scenes = {
  menu: { mode: "menu" },
  battle: { mode: "running" },
  boss: { mode: "running", boss: true },
  camp: { mode: "shop" },
};
for (const element of document.querySelectorAll("[data-scene]")) {
  element.addEventListener("click", () => {
    const key = element.dataset.scene;
    audio.setState(scenes[key]);
    paintLanes();
    status.textContent = `场景 ${key} → ${audio.lanes().join(" / ") || "没有声道"}`;
  });
}

paintLanes();
setInterval(paintLanes, 500);

status.textContent = `就绪：${Object.keys(soundCues).length} 个 cue，${soundFiles.length} 个文件（第一次点击后解锁并开始解码）`;
