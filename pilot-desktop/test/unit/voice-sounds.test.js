// Pilot for Mac 1.3: the voice (Speak replies) and the sound effects.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const SP = require("../../src/renderer/speech");
const S = require("../../src/renderer/sounds");
const V = require("../../src/main/voice");
const T = require("../../src/core/tricks");
const R = require("../../src/core/roam");
const { Settings, DEFAULTS } = require("../../src/main/store");

const ROOT = path.join(__dirname, "..", "..");

// ---------------------------------------------------------------- the voice

test("Speak replies is off by default and remembered", () => {
  assert.equal(DEFAULTS().voice.speak, false);
  assert.equal(V.cleanVoice({}).speak, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-voice-"));
  try {
    const s = new Settings(dir);
    assert.equal(s.get("voice").speak, false);
    s.set("voice", V.cleanVoice({ ...s.get("voice"), speak: true, voiceRate: 1.2 }));
    const again = new Settings(dir);
    assert.equal(again.get("voice").speak, true);
    assert.equal(again.get("voice").voiceRate, 1.2);
    assert.equal(again.get("voice").sounds, true, "sounds on by default");
    assert.ok(again.get("voice").soundVolume <= 0.35, "at a low volume");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // Nonsense is cleaned up.
  const v = V.cleanVoice({ speak: "yes", voice: "Ava; rm -rf /", voiceRate: 9, soundVolume: -1, quietFrom: 25, quietTo: 7.5 });
  assert.deepEqual(v, { speak: true, voice: "", voiceRate: 1.4, sounds: true, soundVolume: 0, quietFrom: 21, quietTo: 7 });
});

test("what he says has no code, links, markdown symbols or emoji", () => {
  const reply = "# Sure! 🎉\nHere's how:\n\n```js\nconsole.log('hi');\n```\n\n- Open **Settings** at https://example.com/a/very/long/path?x=1 \n- Then see [the guide](https://example.com/guide) and `npm test`.\n\n> Done 👍";
  const said = SP.clean(reply);
  assert.doesNotMatch(said, /```|console\.log|https?:|\*\*|#|>|🎉|👍|\[|\]/);
  assert.match(said, /Here's the code\./);
  assert.match(said, /I've put a link in the chat\./);
  assert.equal((said.match(/I've put a link/g) || []).length, 1, "said once, not per link");
  assert.match(said, /Open Settings/);
  assert.match(said, /the guide/);
  assert.match(said, /npm test/);
  assert.equal(SP.clean("Plain words stay as they are."), "Plain words stay as they are.");
  // Sentences start while the reply streams in.
  const s1 = SP.sentences("Hello there. How are", false);
  assert.deepEqual(s1.list, ["Hello there."]);
  assert.deepEqual(SP.sentences("How are you", true).list, ["How are you"]);
});

test("the nicest English voice is picked, never a novelty one", () => {
  const voices = [{ name: "Zarvox", lang: "en-US" }, { name: "Fred", lang: "en-US" }, { name: "Samantha", lang: "en-US" },
    { name: "Ava (Premium)", lang: "en-US" }, { name: "Thomas", lang: "fr-FR" }, { name: "Daniel", lang: "en-GB" }, { name: "Bad News", lang: "en-US" }];
  assert.equal(SP.pickVoice(voices).name, "Ava (Premium)");
  assert.equal(SP.pickVoice(voices, "Daniel").name, "Daniel");
  assert.equal(SP.pickVoice(voices, "Zarvox").name, "Ava (Premium)", "a novelty voice is never used");
  assert.ok(SP.goodVoices(voices).every((v) => !/Zarvox|Fred|Bad News|Thomas/.test(v.name)));
  assert.equal(SP.onlyBasic(voices), false);
  assert.equal(SP.onlyBasic([{ name: "Samantha", lang: "en-US" }]), true);
  assert.equal(SP.pickVoice([{ name: "Zarvox", lang: "en-US" }]), null);
});

function fakeSynth() {
  const spoken = [];
  let cancelled = 0;
  return {
    spoken, get cancelled() { return cancelled; },
    getVoices: () => [{ name: "Samantha", lang: "en-US" }, { name: "Zoe (Enhanced)", lang: "en-US" }],
    speak(u) { spoken.push(u); },
    cancel() { cancelled += 1; spoken.length = 0; },
  };
}
class Utterance { constructor(text) { this.text = text; } }

test("nothing is spoken with the toggle off; on, each sentence starts as it streams; stop stops", () => {
  const synth = fakeSynth();
  const talk = [];
  const sp = SP.create({ synth, Utterance, talking: (on) => talk.push(on) });
  sp.set({ on: false });
  sp.begin();
  sp.stream("Hello there. How are you?");
  sp.finish("Hello there. How are you?");
  assert.equal(synth.spoken.length, 0, "off: silent");
  sp.set({ on: true, ok: false });
  sp.finish("Muted Mac.");
  assert.equal(synth.spoken.length, 0, "muted, locked or full screen: silent");
  sp.set({ on: true, ok: true, rate: 1 });
  sp.begin();
  sp.stream("Hello there. How");
  assert.deepEqual(synth.spoken.map((u) => u.text), ["Hello there."]);
  sp.stream("Hello there. How are you? I'm");
  sp.finish("Hello there. How are you? I'm fine.");
  assert.deepEqual(synth.spoken.map((u) => u.text), ["Hello there.", "How are you?", "I'm fine."]);
  const u = synth.spoken[0];
  assert.equal(u.voice.name, "Zoe (Enhanced)");
  assert.ok(u.rate === 1 && u.pitch > 1 && u.pitch < 1.2, "normal speed, a touch brighter");
  assert.equal(talk[0], true);
  const before = synth.cancelled;
  sp.stop();
  assert.equal(synth.cancelled, before + 1);
  assert.equal(talk[talk.length - 1], false);
  assert.equal(sp.talking, false);
});

test("without Web Speech voices, macOS say is used, with arguments only (no shell)", () => {
  const said = [];
  const sp = SP.create({ synth: { getVoices: () => [], speak() {}, cancel() {} }, Utterance, say: (t, v, r) => said.push([t, v, r]) });
  sp.set({ on: true, ok: true, voice: "Samantha", rate: 1.1 });
  sp.finish("Hi there.");
  assert.deepEqual(said, [["Hi there.", "Samantha", 1.1]]);
  // The arguments: the text is the last one, after "--", so it can never be an option.
  const args = V.sayArgs("-v Zarvox; rm -rf ~ $(touch /tmp/x) `id`", "Samantha", 1);
  assert.deepEqual(args.slice(0, 5), ["-v", "Samantha", "-r", "175", "--"]);
  assert.equal(args[5], "-v Zarvox; rm -rf ~ $(touch /tmp/x) `id`");
  assert.equal(V.sayArgs("hi", "Bad; voice", 1).includes("-v"), false, "an odd voice name is dropped");
  assert.equal(V.sayArgs("x".repeat(5000), "", 1)[3].length, V.SAY_MOST);
  const calls = [];
  const spawn = (cmd, a, opts) => { calls.push({ cmd, a, opts }); const c = new EventEmitter(); c.kill = () => c.emit("exit"); return c; };
  const done = [];
  const say = V.sayer({ spawn, mac: true, onDone: () => done.push(1) });
  assert.equal(say.speak("One.", "Samantha", 1), true);
  assert.equal(say.speak("Two.", "Samantha", 1), true);
  assert.equal(calls.length, 1, "one at a time");
  assert.equal(calls[0].cmd, "/usr/bin/say");
  assert.equal(calls[0].opts.shell, false);
  say.stop();
  assert.equal(say.speaking, false);
  assert.equal(V.sayer({ spawn, mac: false }).speak("Hi"), false);
});

test("the chat has the speaker button, the settings, and the menus have Speak Replies and Sounds", () => {
  const html = fs.readFileSync(path.join(ROOT, "src/renderer/chat.html"), "utf8");
  assert.match(html, /id="speak"[^>]*aria-pressed="false"/);
  const chat = fs.readFileSync(path.join(ROOT, "src/renderer/chat.js"), "utf8");
  for (const words of ["Speak replies out loud", "Try it", "Want a nicer voice? System Settings → Accessibility → Spoken Content → System voice → Manage voices",
    "Quiet hours", "Sound volume"]) assert.ok(chat.includes(words), words);
  const main = fs.readFileSync(path.join(ROOT, "src/main/main.js"), "utf8");
  assert.match(main, /label: "Speak Replies", type: "checkbox"/);
  assert.match(main, /label: "Sounds", type: "checkbox"/);
  assert.match(main, /if \(talking\) stopSpeaking\(\); else toggleChat\(\)/, "a click on the robot stops the voice");
  assert.match(main, /function hideChat\(\) \{\n  stopSpeaking\(\);/, "closing the chat stops the voice");
});

// ---------------------------------------------------------------- the sounds

function fakeAudio() {
  const made = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (type) => { const n = { type, connect() {}, disconnect() {}, start() {}, stop() {}, gain: param(), frequency: param(), Q: param() }; made.push(n); return n; };
  class AC {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; this.state = "running"; AC.count += 1; }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    resume() { this.state = "running"; return Promise.resolve(); }
    createGain() { return node("gain"); }
    createOscillator() { return node("osc"); }
    createBiquadFilter() { return node("filter"); }
    createBufferSource() { return node("source"); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  }
  AC.count = 0;
  return { AC, made };
}
const ok = (extra) => ({ on: true, volume: 0.3, muted: false, fullscreen: false, away: false, talking: false, hour: 14, quietFrom: 21, quietTo: 7, ...(extra || {}) });

test("the right moves make sounds; travel and walking stay silent", () => {
  const g = { pos: { x: 700, y: 892 }, floor: 892, left: 68, right: 1372, top: 187, u: 110, poses: R.ALL_POSES, random: () => 0.4, profile: "desktop" };
  const kinds = (id) => T.plan(id, g, "standing").sounds.map((x) => x.kind);
  assert.ok(kinds("victory-dance").includes("applause") && kinds("victory-dance").includes("applause"));
  assert.ok(kinds("groove").includes("tune") && kinds("disco").includes("tune"));
  assert.ok(kinds("teleport").includes("whoosh") && kinds("head-spin").includes("whoosh"));
  assert.ok(kinds("baseball").includes("crack") && kinds("keepy-uppy").includes("kick"));
  assert.ok(kinds("fireworks").includes("fireworks") && kinds("magic-hat").includes("chime") && kinds("trampoline").includes("boing"));
  assert.ok(kinds("yawn-stretch").includes("yawn") && kinds("sneeze").includes("sneeze"));
  assert.ok(kinds("snowman").includes("jingle") && kinds("pumpkin").includes("spooky"));
  assert.ok(kinds("proud").includes("applause") && kinds("cheering").includes("applause"));
  assert.equal(R.plan("roam", g, "standing").sounds.length, 0);
  assert.equal(R.walkTo(g, 1100, "standing").sounds.length, 0);
  // Not every trick makes a sound.
  assert.ok(T.LIST.filter((m) => !T.plan(m.id, g, "standing").sounds.length).length >= 15);
  for (const m of T.LIST) for (const s of T.plan(m.id, g, "standing").sounds) assert.ok(S.KINDS.includes(s.kind), `${m.id}: ${s.kind}`);
  for (const k of S.KINDS) assert.ok(S.LENGTH[k] <= (k === "tune" ? 8 : 4), k);
});

test("nothing plays when Sounds is off, muted, full screen, away, while he talks, or in quiet hours", () => {
  assert.equal(S.blocked(ok()), "");
  assert.equal(S.blocked(ok({ on: false })), "off");
  assert.equal(S.blocked(ok({ muted: true })), "muted");
  assert.equal(S.blocked(ok({ fullscreen: true })), "fullscreen");
  assert.equal(S.blocked(ok({ away: true })), "away");
  assert.equal(S.blocked(ok({ talking: true })), "talking");
  assert.equal(S.blocked(ok({ hour: 22 })), "quiet");
  assert.equal(S.blocked(ok({ hour: 6 })), "quiet");
  assert.equal(S.blocked(ok({ hour: 7 })), "");
  assert.equal(S.blocked(ok({ hour: 22, quietFrom: 23, quietTo: 6 })), "", "quiet hours can change");
  assert.equal(S.blocked(ok({ hour: 13, quietFrom: 12, quietTo: 14 })), "quiet");
  const { AC, made } = fakeAudio();
  const sfx = S.create({ AudioContext: AC, now: () => 0 });
  assert.equal(sfx.play("applause", ok({ on: false })), false);
  assert.equal(sfx.play("applause", ok({ hour: 23 })), false);
  assert.equal(AC.count, 0, "no audio at all until a sound may play");
  assert.equal(made.length, 0);
});

test("one sound at a time, at least 20 seconds apart (unless picked from the menu), made in code", () => {
  const { AC, made } = fakeAudio();
  let clock = 1000000;
  const sfx = S.create({ AudioContext: AC, now: () => clock });
  assert.equal(sfx.play("pop", ok()), true);
  assert.ok(made.length > 0);
  clock += 500;
  assert.equal(sfx.play("whoosh", ok()), false, "the gap");
  clock += 5000;
  assert.equal(sfx.play("whoosh", ok({ user: true })), true, "picked from the menu");
  assert.equal(sfx.play("pop", ok({ user: true })), false, "never two at once");
  clock += 1000;
  assert.equal(sfx.play("kick", ok({ chain: true })), true, "a later cue of the same move");
  clock += 1000;
  assert.equal(sfx.play("pop", ok()), false);
  clock += S.GAP_MS;
  assert.equal(sfx.play("pop", ok()), true);
  for (const k of S.KINDS) { clock += S.GAP_MS + 9000; assert.equal(sfx.play(k, ok()), true, k); }
  sfx.stop();
  assert.equal(sfx.playing, false);
});

test("no audio files are shipped", () => {
  const found = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== "node_modules" && f.name !== "dist") walk(p); } else if (/\.(mp3|wav|aiff?|m4a|ogg|flac|caf|aac|mid)$/i.test(f.name)) found.push(p);
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "assets"));
  walk(path.join(ROOT, "build"));
  assert.deepEqual(found, []);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "src/renderer/sounds.js"), "utf8"), /new Audio\(|\.mp3|\.wav|fetch\(/);
});

test("stopping never echoes back and forth between the window and the app", () => {
  let stops = 0;
  const sp = SP.create({ synth: fakeSynth(), Utterance, stopSay: () => { stops += 1; } });
  for (let i = 0; i < 5; i += 1) sp.set({ on: false }); // settings arriving again and again while off
  sp.stop(true); // the app said stop
  assert.equal(stops, 0);
  sp.set({ on: true, ok: true });
  sp.finish("Talking now.");
  sp.stop();
  assert.equal(stops, 1, "the window's own stop tells the app once");
  const main = fs.readFileSync(path.join(ROOT, "src/main/main.js"), "utf8");
  assert.match(main, /handle\("voice-stop", \(\) => \{ sayer\.stop\(\); setTalking\(false\);/);
  const chat = fs.readFileSync(path.join(ROOT, "src/renderer/chat.js"), "utf8");
  assert.match(chat, /P\.voice\.onStop\(\(\) => speaker\.stop\(true\)\)/);
});
