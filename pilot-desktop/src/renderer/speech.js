// Pilot for Mac · speech.js: Pilot reads his replies aloud, when the user
// turns "Speak replies" on (off unless they do). The Mac's own voices, free
// and on the Mac, through the Web Speech API; the main process's `say` if
// those aren't there.
//
// Friendly, not creepy: the most natural English voice installed (Premium
// or Enhanced first, never a novelty voice), a normal speed and a slightly
// brighter pitch. Code blocks, long links, emoji and markdown aren't read:
// "Here's the code." and "I've put a link in the chat." instead. While a
// reply streams in, each finished sentence starts at once.
(function (root) {
  "use strict";

  // Natural, friendly English voices that come with macOS (or download).
  const GOOD = ["Ava", "Zoe", "Samantha", "Allison", "Susan", "Evan", "Tom", "Nathan", "Joelle", "Noelle", "Serena", "Kate", "Daniel", "Karen",
    "Lee", "Moira", "Tessa", "Fiona", "Rishi", "Veena", "Oliver", "Siri"];
  // Novelty and robotic voices: never picked by Pilot.
  const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Pipe Organ|Superstar|Trinoids|Wobble|Zarvox|Deranged|Hysterical|Fred|Junior|Ralph|Kathy|Princess|Bruce|Agnes|Vicki|Victoria|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;
  const quality = (v) => (/premium/i.test(v.name) ? 3 : /enhanced|siri/i.test(v.name) ? 2 : 1);

  // English voices worth offering, best first.
  function goodVoices(list) {
    const en = (list || []).filter((v) => /^en([-_]|$)/i.test(v.lang || "") && !NOVELTY.test(v.name || ""));
    const known = (v) => GOOD.findIndex((g) => (v.name || "").startsWith(g));
    return en.filter((v) => known(v) >= 0 || quality(v) > 1).sort((a, b) => quality(b) - quality(a)
      || (known(a) < 0 ? 99 : known(a)) - (known(b) < 0 ? 99 : known(b)) || (/en[-_]US/i.test(b.lang) ? 1 : 0) - (/en[-_]US/i.test(a.lang) ? 1 : 0));
  }
  // The voice to use: the one the user picked if it's there, else the best.
  function pickVoice(list, wanted) {
    const good = goodVoices(list);
    return (wanted && good.find((v) => v.name === wanted)) || good[0] || null;
  }
  // Only plain voices installed: suggest a nicer one.
  const onlyBasic = (list) => !goodVoices(list).some((v) => quality(v) > 1);

  const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

  // What to say for a reply: no code, links, emoji or markdown symbols.
  function clean(text) {
    let s = String(text || "");
    s = s.replace(/```[\s\S]*?(```|$)/g, " Here's the code. ");
    s = s.replace(/`([^`\n]{1,40})`/g, "$1").replace(/`[^`\n]*`/g, " ");
    let linked = false;
    const link = () => { if (linked) return " "; linked = true; return " I've put a link in the chat. "; };
    s = s.replace(/!?\[([^\]\n]{0,200})\]\((https?:\/\/|mailto:)[^)\s]*\)/g, (m, label) => (label && label.length < 60 && !/^https?:/i.test(label) ? `${label} ` : link()));
    s = s.replace(/\b(https?:\/\/|www\.)[^\s)]+/gi, link).replace(/\bmailto:[^\s)]+/gi, link);
    s = s.replace(EMOJI, "");
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s*>\s?/gm, "").replace(/^\s*([-*+]|\d+[.)])\s+/gm, "").replace(/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*$/gm, "");
    s = s.replace(/\|/g, ", ").replace(/(\*\*|__|~~)/g, "").replace(/(^|\s)[*_](\S[^*_\n]*\S|\S)[*_](?=\s|[.,!?]|$)/g, "$1$2").replace(/[*_#>~^=]/g, " ");
    s = s.replace(/\s*\n+\s*/g, ". ").replace(/\s{2,}/g, " ").replace(/(\.\s*){2,}/g, ". ").replace(/\s+([.,!?])/g, "$1").trim();
    return s.replace(/^[.,\s]+/, "");
  }

  // Finished sentences in some text (the rest is still coming).
  function sentences(text, final) {
    const out = [];
    const re = /[^.!?…]+(?:[.!?…]+["')\]]*)(?=\s|$)/g;
    let m;
    let end = 0;
    while ((m = re.exec(text))) { out.push(m[0].trim()); end = re.lastIndex; }
    const rest = text.slice(end).trim();
    if (final && rest) { out.push(rest); end = text.length; }
    return { list: out.filter(Boolean), used: end };
  }

  // A speaker for a window. deps: {synth (speechSynthesis), Utterance
  // (SpeechSynthesisUtterance), say(text, voice, rate) (the fallback),
  // stopSay(), talking(on) (the robot's talking look)}.
  function create(deps) {
    const d = deps || {};
    const synth = d.synth;
    let opts = { on: false, voice: "", rate: 1, ok: true };
    let raw = ""; // the reply so far, as streamed
    let said = 0; // how much of its cleaned text has been queued
    let queue = 0;
    let talkingNow = false;
    const voices = () => (synth && synth.getVoices ? synth.getVoices() : []);
    const useSay = () => !synth || !d.Utterance || !voices().length;
    const talking = (on) => { if (on !== talkingNow) { talkingNow = on; if (d.talking) d.talking(on); } };

    function say(words) {
      if (!words || !opts.on || !opts.ok) return;
      if (useSay()) { if (d.say) { d.say(words, opts.voice, opts.rate); talking(true); } return; }
      const u = new d.Utterance(words);
      const v = pickVoice(voices(), opts.voice);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = opts.rate;
      u.pitch = 1.08; // a touch brighter, never squeaky
      u.volume = 1;
      queue += 1;
      u.onend = u.onerror = () => { queue = Math.max(0, queue - 1); if (!queue) talking(false); };
      synth.speak(u);
      talking(true);
    }

    function feed(text, final) {
      raw = String(text || "");
      const all = clean(raw);
      const { list, used } = sentences(all.slice(said), final);
      said += used;
      for (const s of list) say(s);
    }

    // fromApp: the app said to stop (it has stopped its own voice already).
    function stop(fromApp) {
      raw = "";
      said = 0;
      queue = 0;
      if (synth && synth.cancel) synth.cancel();
      if (d.stopSay && !fromApp && talkingNow) d.stopSay();
      talking(false);
    }

    return {
      set(o) { opts = { ...opts, ...(o || {}) }; if (!opts.on || !opts.ok) stop(); },
      // A reply is streaming in: speak each sentence as it completes.
      stream(text) { if (opts.on && opts.ok) feed(text, false); },
      // The reply is done: speak the rest.
      finish(text) { if (opts.on && opts.ok) feed(text, true); said = 0; raw = ""; },
      // A new reply: start counting from its beginning.
      begin() { said = 0; raw = ""; },
      stop,
      // "Try it".
      sample() { const on = opts.on; opts.on = true; say("Hi! I'm Pilot."); opts.on = on; },
      get talking() { return talkingNow; },
    };
  }

  const api = { GOOD, NOVELTY, goodVoices, pickVoice, onlyBasic, clean, sentences, create };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotSpeech = api;
})(typeof window !== "undefined" ? window : globalThis);
