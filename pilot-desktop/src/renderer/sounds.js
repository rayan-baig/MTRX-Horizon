// Pilot for Mac · sounds.js: little sound effects and tunes for some of the
// robot's moves (Pilot for Mac 1.3): applause, a short tune for dances, a
// whoosh, a bat's crack, a boing, chimes, sleigh bells, a spooky-cute
// wobble, fireworks. Every one is made here with the Web Audio API
// (oscillators, noise and envelopes); no audio files, no borrowed tunes.
//
// Manners: only when the user has Sounds on, never while the Mac is muted,
// something is full screen in front, the Mac is idle or locked, during quiet
// hours (9 pm to 7 am unless changed), or while Pilot is speaking; one sound
// at a time, and at least 20 seconds between sounds unless the user picked
// the trick from the menu. Soft, short (a few seconds; tunes up to 8).
(function (root) {
  "use strict";

  const GAP_MS = 20000;
  const KINDS = ["applause", "tune", "whoosh", "swish", "crack", "thwack", "pop", "kick", "boing", "chime", "yawn", "sneeze", "jingle",
    "spooky", "fireworks", "shutter", "knock"];
  const LENGTH = { applause: 2.6, tune: 6.5, whoosh: 0.7, swish: 0.4, crack: 0.5, thwack: 0.4, pop: 0.3, kick: 0.35, boing: 0.7, chime: 1.6,
    yawn: 1.4, sneeze: 1.1, jingle: 2.6, spooky: 2.4, fireworks: 3.2, shutter: 0.3, knock: 0.3 };

  // Is the hour inside quiet hours (from..to, wrapping past midnight)?
  function quiet(hour, from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
    return from < to ? hour >= from && hour < to : hour >= from || hour < to;
  }

  // Why a sound mustn't play now, or "". c: {on, muted, fullscreen, away,
  // talking, hour, quietFrom, quietTo, user (picked from the menu), chain
  // (a later cue of a move that already made a sound), sinceLast, playing}
  function blocked(c) {
    const x = c || {};
    if (!x.on) return "off";
    if (x.muted) return "muted";
    if (x.fullscreen) return "fullscreen";
    if (x.away) return "away";
    if (x.talking) return "talking";
    if (quiet(x.hour, x.quietFrom, x.quietTo)) return "quiet";
    if (x.playing) return "playing";
    if (!x.user && !x.chain && x.sinceLast < GAP_MS) return "gap";
    return "";
  }

  // ------------------------------------------------------------------ the synth

  function create(opts) {
    const o = opts || {};
    const AC = o.AudioContext || root.AudioContext || root.webkitAudioContext;
    const now = o.now || Date.now;
    let ctx = null;
    let master = null;
    let noiseBuf = null;
    let busyUntil = 0;
    let last = -Infinity;
    let nodes = [];
    let sleep = null;

    function audio() {
      if (!ctx && AC) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.3;
        master.connect(ctx.destination);
      }
      return ctx;
    }
    function noise() {
      if (noiseBuf) return noiseBuf;
      const len = Math.floor(ctx.sampleRate * 1);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < len; i += 1) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
      return noiseBuf;
    }
    const keep = (n) => { nodes.push(n); return n; };
    // An envelope on a gain: attack, hold, decay to silence.
    function env(t, peak, a, d, hold) {
      const g = keep(ctx.createGain());
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      if (hold) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + (hold || 0) + d);
      g.connect(master);
      return g;
    }
    function tone(t, freq, dur, type, peak, glideTo) {
      const osc = keep(ctx.createOscillator());
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      osc.connect(env(t, peak || 0.3, 0.01, dur));
      osc.start(t);
      osc.stop(t + dur + 0.05);
      return osc;
    }
    function hiss(t, dur, filter, f0, f1, peak, q) {
      const src = keep(ctx.createBufferSource());
      src.buffer = noise();
      const bq = keep(ctx.createBiquadFilter());
      bq.type = filter || "bandpass";
      bq.frequency.setValueAtTime(f0, t);
      if (f1) bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
      bq.Q.value = q || 1;
      src.connect(bq);
      bq.connect(env(t, peak || 0.3, Math.min(0.05, dur / 3), dur));
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.05);
      return src;
    }
    const note = (n) => 440 * Math.pow(2, (n - 69) / 12);

    // Short tunes of our own (MIDI notes, beats), played on a soft triangle.
    const TUNES = [
      [[72, 1], [76, 1], [79, 1], [76, 1], [77, 1], [81, 1], [79, 2], [76, 1], [79, 1], [84, 2], [83, 1], [79, 1], [81, 2]],
      [[67, 1], [71, 1], [74, 2], [72, 1], [71, 1], [69, 2], [67, 1], [69, 1], [71, 1], [74, 1], [72, 2], [79, 2]],
      [[76, 1], [74, 1], [72, 1], [74, 1], [76, 1], [76, 1], [79, 2], [77, 1], [76, 1], [74, 1], [77, 1], [76, 2], [72, 2]],
    ];
    let tuneN = 0;

    const RECIPES = {
      // Applause: lots of short filtered noise claps, swelling and fading.
      applause(t) {
        for (let i = 0; i < 70; i += 1) {
          const at = t + Math.random() * 2.3;
          const swell = Math.sin(Math.PI * Math.min(1, (at - t) / 2.3));
          hiss(at, 0.05 + Math.random() * 0.04, "bandpass", 1400 + Math.random() * 1800, 0, 0.12 + 0.18 * swell, 1.4);
        }
        hiss(t, 2.4, "bandpass", 2000, 1600, 0.05, 0.6);
      },
      tune(t) {
        const tune = TUNES[tuneN % TUNES.length];
        tuneN += 1;
        const beat = 0.24;
        let at = t;
        for (const [n, b] of tune) {
          tone(at, note(n), beat * b * 0.9, "triangle", 0.18);
          tone(at, note(n - 12), beat * b * 0.9, "sine", 0.08);
          at += beat * b;
        }
        // A soft beat underneath.
        for (let i = 0; at - t > i * beat * 2; i += 1) tone(t + i * beat * 2, 110, 0.12, "sine", 0.12, 55);
      },
      whoosh(t) { hiss(t, 0.6, "bandpass", 300, 2400, 0.35, 2); },
      swish(t) { hiss(t, 0.3, "bandpass", 1200, 4000, 0.3, 3); },
      crack(t) { hiss(t, 0.06, "highpass", 2500, 0, 0.5); tone(t, 180, 0.15, "triangle", 0.25, 90); },
      thwack(t) { hiss(t, 0.1, "lowpass", 900, 0, 0.45); tone(t, 140, 0.2, "sine", 0.3, 60); },
      pop(t) { tone(t, 900, 0.12, "sine", 0.3, 300); hiss(t, 0.04, "highpass", 3000, 0, 0.2); },
      kick(t) { tone(t, 150, 0.25, "sine", 0.4, 50); hiss(t, 0.05, "lowpass", 1200, 0, 0.2); },
      boing(t) {
        const osc = tone(t, 220, 0.6, "sine", 0.3);
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(520, t + 0.15);
        osc.frequency.exponentialRampToValueAtTime(330, t + 0.6);
      },
      chime(t) { [84, 88, 91, 96].forEach((n, i) => { tone(t + i * 0.09, note(n), 1.1, "sine", 0.16); tone(t + i * 0.09, note(n + 12), 0.6, "sine", 0.05); }); },
      // Not a voice: a little slide whistle going sleepy.
      yawn(t) { tone(t, 700, 0.5, "triangle", 0.16, 900); tone(t + 0.45, 900, 0.8, "triangle", 0.16, 380); },
      sneeze(t) { tone(t, 500, 0.5, "triangle", 0.12, 1100); hiss(t + 0.6, 0.35, "bandpass", 3000, 1500, 0.35, 1.2); },
      jingle(t) {
        for (let i = 0; i < 8; i += 1) { hiss(t + i * 0.28, 0.12, "highpass", 6000, 0, 0.12, 0.7); tone(t + i * 0.28, note(96 + (i % 2) * 4), 0.25, "sine", 0.06); }
        [76, 76, 76, 0, 76, 76, 76, 0, 76, 79, 72, 74, 76].forEach((n, i) => { if (n) tone(t + i * 0.18, note(n + 12), 0.17, "triangle", 0.1); });
      },
      spooky(t) {
        const osc = tone(t, 520, 2.2, "sine", 0.16, 300);
        const lfo = keep(ctx.createOscillator());
        const depth = keep(ctx.createGain());
        lfo.frequency.value = 6;
        depth.gain.value = 18;
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + 2.3);
      },
      fireworks(t) {
        for (let i = 0; i < 5; i += 1) {
          const at = t + i * 0.55 + Math.random() * 0.1;
          hiss(at, 0.35, "bandpass", 600, 3000, 0.08, 2);
          tone(at + 0.3, 90, 0.4, "sine", 0.35, 40);
          for (let j = 0; j < 6; j += 1) hiss(at + 0.35 + Math.random() * 0.4, 0.03, "highpass", 4000, 0, 0.12);
        }
      },
      shutter(t) { hiss(t, 0.03, "highpass", 3000, 0, 0.3); hiss(t + 0.08, 0.04, "bandpass", 2000, 0, 0.25); },
      knock(t) { tone(t, 200, 0.1, "sine", 0.35, 120); hiss(t, 0.03, "lowpass", 800, 0, 0.25); },
    };

    // Play a sound now if it may (c: as blocked() takes, without sinceLast
    // and playing). Returns true when it plays.
    function play(kind, c) {
      if (!RECIPES[kind]) return false;
      const t0 = now();
      const why = blocked({ ...(c || {}), sinceLast: t0 - last, playing: t0 < busyUntil });
      if (why) return false;
      if (!audio()) return false;
      if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(() => {});
      const vol = Math.max(0, Math.min(1, Number((c || {}).volume)));
      master.gain.value = (Number.isFinite(vol) ? vol : 0.3) * 0.6;
      nodes = [];
      RECIPES[kind](ctx.currentTime + 0.02);
      last = t0;
      busyUntil = t0 + LENGTH[kind] * 1000;
      // Between sounds the audio engine sleeps, so it costs nothing.
      clearTimeout(sleep);
      sleep = setTimeout(() => { if (ctx && ctx.suspend && now() >= busyUntil) ctx.suspend().catch(() => {}); }, LENGTH[kind] * 1000 + 500);
      return true;
    }

    // Quiet at once (Pilot starts talking, the move was stopped).
    function stop() {
      for (const n of nodes) { try { if (n.stop) n.stop(); } catch (_) { /* done already */ } try { n.disconnect(); } catch (_) { /* gone */ } }
      nodes = [];
      busyUntil = 0;
      clearTimeout(sleep);
      if (ctx && ctx.suspend) ctx.suspend().catch(() => {});
    }

    return { play, stop, get playing() { return now() < busyUntil; }, get last() { return last; } };
  }

  const api = { KINDS, LENGTH, GAP_MS, quiet, blocked, create };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotSounds = api;
})(typeof window !== "undefined" ? window : globalThis);
