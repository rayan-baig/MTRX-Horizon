// Pilot for Mac · props.js: the small drawings the new tricks use (Pilot
// for Mac 1.3): balls, a hoop, a top hat, a kite, an umbrella, a cake, snow,
// leaves, confetti, music notes and the rest. All drawn here as SVG, with
// attributes only (no style attributes, no new pictures), so the strict
// Content-Security-Policy is fine.
//
// pilot-actor.js makes an empty <span class="pa-prop pa-prop-KIND"> for a
// prop it doesn't draw itself, and a <span class="pa-fx pa-fx-KIND"> for an
// effect; attach(stage) watches the stage and draws into each one as it
// appears (before it's painted). The actor removes them, as always, when
// the move ends or stops, so nothing is left behind. tricks.css animates
// the effects.
//
// Each drawing is in hundredths of the robot's resting width (100 = 1 width,
// var(--pa-u)), with 0,0 at its anchor: the point the move places. Every
// <svg> is the same box, one width square around the anchor, showing what
// lies outside it too (tricks.css), so no drawing needs a size of its own.
// The owner's own props (a door, a trophy, a crown, a globe and two glowing
// screens) are pictures in assets/props/, sized in tricks.css.
(function (root) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  // Colours: the robot's blue and violet, and a few plain ones.
  const BLUE = "#60a5fa";
  const VIOLET = "#8b5cf6";
  const CYAN = "#22d3ee";
  const WHITE = "#f8fafc";
  const INK = "#0f172a";
  const GOLD = "#fbbf24";
  const PINK = "#f472b6";
  const RED = "#ef4444";
  const GREEN = "#22c55e";
  const ORANGE = "#f97316";

  // Shorthands for the parts: [tag, attributes].
  const c = (cx, cy, r, fill, a) => ["circle", { cx, cy, r, fill, ...(a || {}) }];
  const e = (cx, cy, rx, ry, fill, a) => ["ellipse", { cx, cy, rx, ry, fill, ...(a || {}) }];
  const r = (x, y, width, height, fill, a) => ["rect", { x, y, width, height, fill, ...(a || {}) }];
  const p = (d, fill, a) => ["path", { d, fill: fill || "none", ...(a || {}) }];
  const s = (d, stroke, w, a) => ["path", { d, fill: "none", stroke, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round", ...(a || {}) }];
  const t = (x, y, text, size, fill, a) => ["text", { x, y, "font-size": size, "font-weight": 800, "text-anchor": "middle", fill,
    "font-family": "system-ui, -apple-system, sans-serif", _text: text, ...(a || {}) }];
  const grad = (id, stops, a) => ["linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1, ...(a || {}), _kids: stops.map(([o, col]) => ["stop", { offset: o, "stop-color": col }]) }];
  const rgrad = (id, stops) => ["radialGradient", { id, _kids: stops.map(([o, col, op]) => ["stop", { offset: o, "stop-color": col, "stop-opacity": op === undefined ? 1 : op }]) }];

  // A five-pointed star of radius rr at x, y.
  function starPath(x, y, rr, inner) {
    const pts = [];
    for (let i = 0; i < 10; i += 1) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const d = i % 2 ? rr * (inner || 0.45) : rr;
      pts.push(`${(x + Math.cos(a) * d).toFixed(1)} ${(y + Math.sin(a) * d).toFixed(1)}`);
    }
    return `M${pts.join("L")}Z`;
  }
  const heartPath = (x, y, k) => `M${x} ${y + 3 * k}C${x - 9 * k} ${y - 3 * k} ${x - 4 * k} ${y - 10 * k} ${x} ${y - 5 * k}C${x + 4 * k} ${y - 10 * k} ${x + 9 * k} ${y - 3 * k} ${x} ${y + 3 * k}Z`;
  const flowerPart = (x, y, petal, mid) => {
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      const a = (Math.PI * 2 * i) / 5;
      out.push(c(x + Math.cos(a) * 4.5, y + Math.sin(a) * 4.5, 3.8, petal));
    }
    out.push(c(x, y, 2.8, mid));
    return out;
  };

  // ------------------------------------------------------------------ props
  // box: [x, y, width, height] around the anchor; parts(n): the drawing (n
  // makes gradient ids unique). flat: no glow around it.
  const PROPS = {
    basketball: { box: [-9, -9, 18, 18], parts: () => [c(0, 0, 8, ORANGE, { stroke: "#7c2d12", "stroke-width": 0.8 }),
      s("M-8 0H8M0-8V8M-5.6-5.6C-2-2-2 2-5.6 5.6M5.6-5.6C2-2 2 2 5.6 5.6", "#7c2d12", 0.8)] },
    hoop: { box: [-36, -210, 72, 212], parts: (n) => [grad(`hp${n}`, [[0, "#c7d2fe"], [1, VIOLET]]),
      r(-3, -150, 6, 150, `url(#hp${n})`, { rx: 2 }), r(-32, -208, 64, 46, "rgba(224,231,255,0.18)", { stroke: "#c7d2fe", "stroke-width": 2.4, rx: 3 }),
      r(-11, -196, 22, 18, "none", { stroke: WHITE, "stroke-width": 1.6 }),
      s("M-15-160L-11-140M-5-160L-4-140M5-160L4-140M15-160L11-140M-13-150H13M-11-142H11", WHITE, 0.9, { opacity: 0.8 }),
      e(0, -161, 16, 3.6, "none", { stroke: ORANGE, "stroke-width": 2.6 }), e(0, 0, 18, 2.6, "rgba(15,23,42,0.35)")] },
    bat: { box: [-5, -74, 10, 78], parts: () => [p("M-1.6 2L-2.2-30C-3.8-50-4.6-60-4-70C-3.6-74 3.6-74 4-70C4.6-60 3.8-50 2.2-30L1.6 2Z", "#d6a46b", { stroke: "#7c4a1e", "stroke-width": 0.8 }),
      r(-2.6, -2, 5.2, 5, "#334155", { rx: 1.5 })] },
    baseball: { box: [-5, -5, 10, 10], parts: () => [c(0, 0, 4.5, WHITE, { stroke: "#cbd5e1", "stroke-width": 0.5 }), s("M-2.6-3.4C-1-1-1 1-2.6 3.4M2.6-3.4C1-1 1 1 2.6 3.4", RED, 0.7)] },
    putter: { box: [-8, -2, 16, 62], parts: () => [s("M0 0L0.5 55", "#cbd5e1", 2), r(-1.5, 54, 9, 4, "#94a3b8", { rx: 1.2 }), r(-1.6, -1, 3.2, 10, "#1e293b", { rx: 1.2 })] },
    golfball: { box: [-4, -4, 8, 8], parts: () => [c(0, 0, 3.5, WHITE, { stroke: "#cbd5e1", "stroke-width": 0.5 }), c(-1, -1, 0.6, "#cbd5e1"), c(1.2, 0.6, 0.6, "#cbd5e1")] },
    flag: { box: [-10, -76, 36, 80], parts: () => [e(0, -1, 9, 2.6, INK, { stroke: "#334155", "stroke-width": 0.8 }), s("M0-1V-74", WHITE, 1.6),
      p("M0-74L24-66L0-58Z", RED)] },
    bowlingball: { box: [-10, -10, 20, 20], parts: (n) => [rgrad(`bb${n}`, [[0, "#a78bfa"], [0.7, "#4c1d95"], [1, "#2e1065"]]), c(0, 0, 9, `url(#bb${n})`),
      c(-2.5, -3.5, 1.4, INK), c(1.5, -4.5, 1.4, INK), c(-0.2, -0.8, 1.6, INK)] },
    pin: { box: [-7, -32, 14, 33], parts: () => [p("M0-31C3-31 3.5-27 2.6-24C2-22 2.2-21 3.4-18C6-13 6-6 4.4 0H-4.4C-6-6-6-13-3.4-18C-2.2-21-2-22-2.6-24C-3.5-27-3-31 0-31Z", WHITE, { stroke: "#cbd5e1", "stroke-width": 0.6 }),
      r(-2.6, -22, 5.2, 1.6, RED), r(-2.9, -19.4, 5.8, 1.4, RED)] },
    skateboard: { box: [-36, -2, 72, 15], parts: (n) => [grad(`sk${n}`, [[0, VIOLET], [1, "#4c1d95"]]),
      p("M-30 0H30C34 0 35 -3 36 -4L35 3H-35L-36 -4C-35 -3 -34 0 -30 0Z", `url(#sk${n})`, { stroke: "#c4b5fd", "stroke-width": 0.8 }),
      c(-22, 8.5, 4, INK, { stroke: CYAN, "stroke-width": 1.4 }), c(22, 8.5, 4, INK, { stroke: CYAN, "stroke-width": 1.4 })] },
    surfboard: { box: [-48, -3, 96, 10], parts: (n) => [grad(`sf${n}`, [[0, CYAN], [1, BLUE]], { x2: 1, y2: 0 }),
      p("M-46 2C-30-3 30-3 46 1C30 6-30 6-46 2Z", `url(#sf${n})`, { stroke: WHITE, "stroke-width": 0.8 }), s("M-40 2H40", WHITE, 0.8, { opacity: 0.7 })] },
    wave: { box: [-130, -86, 260, 88], flat: true, parts: (n) => [grad(`wv${n}`, [[0, "#7dd3fc"], [0.5, "#2563eb"], [1, "#1e3a8a"]]),
      p("M-130 0V-30C-100-34-80-46-60-62C-40-80-10-86 12-78C30-72 34-58 24-52C16-48 8-56 0-52C-10-46 10-36 30-34C60-30 90-30 130-34V0Z", `url(#wv${n})`),
      s("M-60-62C-40-80-10-86 12-78C30-72 34-58 24-52", WHITE, 3, { opacity: 0.85 }), s("M-110-28C-80-30-60-36-40-44M40-30C70-28 100-30 125-33", WHITE, 1.4, { opacity: 0.55 })] },
    skis: { box: [-46, -6, 92, 10], parts: () => [s("M-42 1H38C42 1 44-2 45-5", "#f43f5e", 3), s("M-38 3H40C44 3 46 0 47-3", "#fb7185", 2.4)] },
    // A snowy slope from high on the left (0, -150) down to the floor at the right (300, 0).
    slope: { box: [-2, -152, 302, 154], flat: true, parts: (n) => [grad(`sl${n}`, [[0, WHITE], [1, "#bfdbfe"]]),
      p("M0 0V-150L300 0Z", `url(#sl${n})`, { opacity: 0.92 }), s("M0-150L300 0", "#e0f2fe", 2.4), s("M90-104L120-98M180-62L205-56M240-30L260-26", "#93c5fd", 1.2, { opacity: 0.7 })] },
    frisbee: { box: [-13, -5, 26, 10], parts: (n) => [grad(`fr${n}`, [[0, "#f0abfc"], [1, VIOLET]]), e(0, 0, 12, 3.6, `url(#fr${n})`, { stroke: WHITE, "stroke-width": 0.7 }), e(0, -0.8, 6, 1.4, "rgba(255,255,255,0.45)")] },
    water: { box: [-200, -34, 400, 36], flat: true, parts: (n) => [grad(`wt${n}`, [[0, "rgba(125,211,252,0.85)"], [1, "rgba(30,64,175,0.9)"]]),
      p("M-200-24Q-190 -31 -180-24Q-170 -17 -160-24Q-150 -31 -140-24Q-130 -17 -120-24Q-110 -31 -100-24Q-90 -17 -80-24Q-70 -31 -60-24Q-50 -17 -40-24Q-30 -31 -20-24Q-10 -17 0-24Q10 -31 20-24Q30 -17 40-24Q50 -31 60-24Q70 -17 80-24Q90 -31 100-24Q110 -17 120-24Q130 -31 140-24Q150 -17 160-24Q170 -31 180-24Q190 -17 200-24V2H-200Z", `url(#wt${n})`),
      s("M-200-24Q-190 -31 -180-24Q-170 -17 -160-24Q-150 -31 -140-24Q-130 -17 -120-24Q-110 -31 -100-24Q-90 -17 -80-24Q-70 -31 -60-24Q-50 -17 -40-24Q-30 -31 -20-24Q-10 -17 0-24Q10 -31 20-24Q30 -17 40-24Q50 -31 60-24Q70 -17 80-24Q90 -31 100-24Q110 -17 120-24Q130 -31 140-24Q150 -17 160-24Q170 -31 180-24Q190 -17 200-24", WHITE, 1.2, { opacity: 0.7 })] },
    goalfront: { box: [-96, -122, 192, 124], flat: true, parts: () => {
      const d = [];
      for (let x = -80; x <= 80; x += 12) d.push(`M${x} -108V0`);
      for (let y = -96; y < 0; y += 12) d.push(`M-88 ${y}H88`);
      return [s(d.join(""), "#93c5fd", 0.8, { opacity: 0.45 }), s("M-90 0V-112H90V0", WHITE, 4), s("M-90-112L-80-104H80L90-112", "#c7d2fe", 1.4, { opacity: 0.7 })];
    } },
    highbar: { box: [-60, -96, 120, 98], parts: () => [s("M-50 0V-92M50 0V-92", "#c7d2fe", 3), s("M-48-74H48", GOLD, 2.6), s("M-56 0H-44M44 0H56", "#c7d2fe", 3)] },
    mat: { box: [-62, -24, 124, 26], parts: (n) => [grad(`mt${n}`, [[0, BLUE], [1, "#1e3a8a"]]), r(-60, -22, 120, 22, `url(#mt${n})`, { rx: 6, stroke: "#bfdbfe", "stroke-width": 1 })] },
    yoyostring: { box: [-1, 0, 2, 100], flat: true, parts: () => [s("M0 0V100", WHITE, 0.8, { "vector-effect": "non-scaling-stroke" })] },
    yoyo: { box: [-7, -7, 14, 14], parts: (n) => [rgrad(`yy${n}`, [[0, "#fda4af"], [1, RED]]), c(0, 0, 6.4, `url(#yy${n})`, { stroke: "#7f1d1d", "stroke-width": 0.8 }), c(0, 0, 1.6, WHITE)] },
    gum: { box: [-14, -14, 28, 28], flat: true, parts: (n) => [rgrad(`gm${n}`, [[0, "#fbcfe8"], [0.7, PINK], [1, "#db2777"]]), c(0, 0, 12, `url(#gm${n})`, { opacity: 0.92 }),
      e(-4, -5, 3.4, 2, "rgba(255,255,255,0.75)")] },
    tophat: { box: [-24, -40, 48, 42], parts: () => [e(0, -2, 22, 4.4, INK, { stroke: "#334155", "stroke-width": 1 }), r(-14, -38, 28, 36, INK, { stroke: "#334155", "stroke-width": 1 }),
      r(-14, -12, 28, 5, VIOLET), e(0, -38, 14, 3, "#1e293b")] },
    wand: { box: [-3, -40, 6, 42], parts: () => [r(-1.6, -38, 3.2, 38, INK, { stroke: "#475569", "stroke-width": 0.6 }), r(-1.7, -40, 3.4, 7, WHITE)] },
    bunny: { box: [-14, -40, 28, 42], parts: () => [e(-5, -30, 3.4, 10, WHITE, { stroke: "#e2e8f0", "stroke-width": 0.6 }), e(5, -30, 3.4, 10, WHITE, { stroke: "#e2e8f0", "stroke-width": 0.6 }),
      e(-5, -30, 1.4, 6, "#fbcfe8"), e(5, -30, 1.4, 6, "#fbcfe8"), c(0, -12, 11, WHITE, { stroke: "#e2e8f0", "stroke-width": 0.6 }),
      c(-4, -14, 1.5, INK), c(4, -14, 1.5, INK), c(0, -10, 1.4, PINK)] },
    jball1: { box: [-6, -6, 12, 12], parts: () => [c(0, 0, 5, RED, { stroke: WHITE, "stroke-width": 0.8 })] },
    jball2: { box: [-6, -6, 12, 12], parts: () => [c(0, 0, 5, GOLD, { stroke: WHITE, "stroke-width": 0.8 })] },
    jball3: { box: [-6, -6, 12, 12], parts: () => [c(0, 0, 5, GREEN, { stroke: WHITE, "stroke-width": 0.8 })] },
    plane: { box: [-16, -8, 32, 16], parts: () => [p("M15 0L-15-7L-8 0Z", WHITE, { stroke: "#cbd5e1", "stroke-width": 0.6 }), p("M15 0L-8 0L-15 7Z", "#e2e8f0", { stroke: "#cbd5e1", "stroke-width": 0.6 }),
      s("M15 0L-8 0", "#94a3b8", 0.6)] },
    kite: { box: [-18, -22, 40, 70], parts: () => [p("M0-20L14 0L0 24L-14 0Z", VIOLET, { stroke: WHITE, "stroke-width": 1 }), p("M0-20L14 0L0 0Z", PINK),
      p("M0 0L-14 0L0 24Z", CYAN), s("M0 24C4 30-4 34 2 40C6 44 2 46 4 48", WHITE, 0.9), p("M2 32l3-2v4Z", GOLD), p("M3 42l3-2v4Z", GOLD)] },
    line: { box: [0, -1, 100, 2], flat: true, parts: () => [s("M0 0H100", WHITE, 0.8, { "vector-effect": "non-scaling-stroke", opacity: 0.85 })] },
    balloon: { box: [-16, -84, 32, 86], parts: (n) => [rgrad(`bl${n}`, [[0, "#fecaca"], [0.6, RED], [1, "#991b1b"]]), s("M0 0C-3-10 3-20 0-30C-2-40 2-46 0-52", WHITE, 0.8),
      e(0, -68, 13, 15.5, `url(#bl${n})`), p("M-2.4-52.6L2.4-52.6L0-55Z", "#991b1b"), e(-4.6, -73, 3, 4.5, "rgba(255,255,255,0.55)")] },
    trampoline: { box: [-60, -26, 120, 28], parts: () => [s("M-50 0L-44-20M50 0L44-20M-10 0L-6-20M10 0L6-20", "#94a3b8", 2.4), e(0, -20, 52, 5, INK, { stroke: CYAN, "stroke-width": 2.4 }),
      s("M-46-20H46", BLUE, 1.2, { opacity: 0.6 })] },
    trampbed: { box: [-48, -4, 96, 8], flat: true, parts: () => [e(0, 0, 44, 3, "rgba(96,165,250,0.55)")] },
    pogo: { box: [-14, -76, 28, 104], parts: () => [s("M0-70V24", "#cbd5e1", 3), s("M-12-70H12", "#334155", 4), s("M-10 0H10", "#334155", 3.4),
      s("M-3 6L3 9L-3 12L3 15L-3 18", CYAN, 1.4), c(0, 25, 2.4, INK)] },
    cloud: { box: [-40, -22, 80, 40], parts: (n) => [grad(`cl${n}`, [[0, "#cbd5e1"], [1, "#64748b"]]),
      p("M-30 12C-40 12-40-2-30-2C-30-14-14-18-8-10C-4-20 14-20 18-8C28-12 38-4 32 6C38 8 36 14 30 14Z", `url(#cl${n})`, { stroke: "#e2e8f0", "stroke-width": 1 })] },
    sun: { box: [-34, -34, 68, 68], parts: (n) => {
      const rays = [];
      for (let i = 0; i < 12; i += 1) {
        const a = (Math.PI * 2 * i) / 12;
        rays.push(`M${(Math.cos(a) * 22).toFixed(1)} ${(Math.sin(a) * 22).toFixed(1)}L${(Math.cos(a) * 31).toFixed(1)} ${(Math.sin(a) * 31).toFixed(1)}`);
      }
      return [rgrad(`sn${n}`, [[0, "#fef9c3"], [0.6, GOLD], [1, ORANGE]]), s(rays.join(""), GOLD, 3), c(0, 0, 18, `url(#sn${n})`)];
    } },
    sunglasses: { box: [-30, -10, 60, 18], parts: () => [p("M-26-6H-4C-3 4-8 7-15 7C-22 7-26 2-26-6Z", INK, { stroke: "#334155", "stroke-width": 1 }),
      p("M26-6H4C3 4 8 7 15 7C22 7 26 2 26-6Z", INK, { stroke: "#334155", "stroke-width": 1 }), s("M-4-5H4M-26-6L-29-8M26-6L29-8", "#334155", 1.6),
      s("M-22-3L-17-3M8-3L13-3", WHITE, 1.2, { opacity: 0.7 })] },
    moon: { box: [-24, -24, 48, 48], parts: () => [p("M8-20A20 20 0 1 0 8 20A16 16 0 1 1 8-20Z", "#fde68a", { stroke: "#fef3c7", "stroke-width": 1 })] },
    bulb: { box: [-16, -18, 32, 38], parts: (n) => [rgrad(`lb${n}`, [[0, "#fffbeb"], [0.6, "#fde68a"], [1, GOLD]]), c(0, -4, 12, `url(#lb${n})`, { stroke: "#fef3c7", "stroke-width": 1 }),
      r(-5, 7, 10, 8, "#94a3b8", { rx: 1.5 }), s("M-5 10H5M-5 13H5", "#475569", 0.8), s("M-3-5L0-1L3-5", "#f59e0b", 1)] },
    umbrella: { box: [-46, -100, 92, 104], parts: (n) => [grad(`um${n}`, [[0, PINK], [1, VIOLET]]), s("M0 0V-90", "#e2e8f0", 2), s("M0 0C0 4 -6 4 -6 0", "#e2e8f0", 2),
      p("M-44-58C-40-84-20-96 0-96C20-96 40-84 44-58C38-62 30-62 22-58C16-62 6-62 0-58C-6-62-16-62-22-58C-30-62-38-62-44-58Z", `url(#um${n})`, { stroke: WHITE, "stroke-width": 1 })] },
    book: { box: [-24, -16, 48, 32], parts: () => [p("M0-12C-8-16-16-16-22-13V13C-16 10-8 10 0 14Z", WHITE, { stroke: "#cbd5e1", "stroke-width": 0.8 }),
      p("M0-12C8-16 16-16 22-13V13C16 10 8 10 0 14Z", "#f1f5f9", { stroke: "#cbd5e1", "stroke-width": 0.8 }),
      s("M-18-8H-5M-18-4H-5M-18 0H-6M5-8H18M5-4H18M5 0H17", "#94a3b8", 0.8), r(-23, -14, 3, 29, VIOLET, { rx: 1 })] },
    page: { box: [-1, -13, 22, 27], parts: () => [p("M0-12C7-15 14-15 20-12V12C14 9 7 9 0 13Z", WHITE, { stroke: "#cbd5e1", "stroke-width": 0.6 })] },
    cup: { box: [-12, -12, 24, 24], parts: () => [p("M-8-10H8L6.5 10H-6.5Z", WHITE, { stroke: "#cbd5e1", "stroke-width": 0.8 }), r(-7.7, -4, 15.4, 5, BLUE),
      s("M8-6C13-6 13 3 7.2 3", "#cbd5e1", 2), e(0, -10, 8, 1.6, "#92400e")] },
    phone: { box: [-9, -15, 18, 30], parts: (n) => [grad(`ph${n}`, [[0, "#38bdf8"], [1, VIOLET]]), r(-8, -14, 16, 28, INK, { rx: 3, stroke: "#94a3b8", "stroke-width": 1 }),
      r(-6.4, -11.5, 12.8, 22, `url(#ph${n})`, { rx: 1.6 }), c(0, -6, 2.6, WHITE, { opacity: 0.8 })] },
    photo: { box: [-20, -24, 40, 48], parts: () => [r(-18, -22, 36, 44, WHITE, { rx: 2 }), r(-14, -18, 28, 28, "#1e3a8a"),
      c(0, -6, 7, "#e0e7ff"), e(0, -7, 5, 3.4, INK), s("M-2.6-7.6Q-1.6-9-0.6-7.6M0.6-7.6Q1.6-9 2.6-7.6", CYAN, 0.8), p(starPath(9, -14, 2.4), GOLD)] },
    cloth: { box: [-14, -12, 28, 24], parts: () => [p("M-12-8C-6-12 6-10 12-8C10 0 12 6 10 10C2 12-6 8-12 10C-10 2-13-2-12-8Z", "#7dd3fc", { stroke: WHITE, "stroke-width": 0.8 }),
      s("M-8-2C-2-4 4-2 8-4M-7 4C-1 2 5 4 8 2", WHITE, 0.7, { opacity: 0.7 })] },
    marker: { box: [-4, -36, 8, 38], parts: () => [r(-3, -34, 6, 26, INK, { rx: 1.5, stroke: "#334155", "stroke-width": 0.6 }), r(-3, -36, 6, 6, CYAN, { rx: 1.5 }), p("M-3-8H3L0 0Z", CYAN)] },
    "smiley-ring": { box: [-62, -62, 124, 124], flat: true, parts: () => [c(0, 0, 56, "none", { stroke: CYAN, "stroke-width": 5, opacity: 0.9, "stroke-linecap": "round" })] },
    "smiley-eyes": { box: [-40, -40, 80, 40], flat: true, parts: () => [s("M-20-26V-12M20-26V-12", CYAN, 6, { opacity: 0.9 })] },
    "smiley-mouth": { box: [-40, 0, 80, 40], flat: true, parts: () => [s("M-30 12C-16 34 16 34 30 12", CYAN, 5, { opacity: 0.9 })] },
    butterfly: { box: [-14, -12, 28, 24], parts: () => [p("M0 0C-6-12-14-12-13-4C-12 2-6 2 0 0Z", "#f0abfc", { stroke: VIOLET, "stroke-width": 0.8 }),
      p("M0 0C6-12 14-12 13-4C12 2 6 2 0 0Z", "#f0abfc", { stroke: VIOLET, "stroke-width": 0.8 }), p("M0 0C-5 2-10 8-6 10C-3 11-1 5 0 0Z", "#a5f3fc"),
      p("M0 0C5 2 10 8 6 10C3 11 1 5 0 0Z", "#a5f3fc"), s("M0-5V5", INK, 1.6), s("M0-5L-3-9M0-5L3-9", INK, 0.6)] },
    star: { box: [-20, -20, 40, 40], parts: (n) => [rgrad(`st${n}`, [[0, "#fffbeb"], [0.5, "#fde68a"], [1, GOLD]]), p(starPath(0, 0, 17), `url(#st${n})`, { stroke: "#fef3c7", "stroke-width": 1 })] },
    rope: { box: [0, -2, 100, 4], flat: true, parts: () => [s("M0 0H100", "#e2e8f0", 2, { "vector-effect": "non-scaling-stroke" })] },
    pole: { box: [-72, -3, 144, 6], parts: () => [s("M-70 0H70", "#e2e8f0", 2.2), c(-70, 0, 2.6, VIOLET), c(70, 0, 2.6, VIOLET)] },
    discoball: { box: [-18, 0, 36, 98], parts: (n) => {
      const d = [];
      for (let y = 66; y < 96; y += 5) d.push(`M-16 ${y}H16`);
      for (let x = -12; x <= 12; x += 6) d.push(`M${x} 64V96`);
      return [rgrad(`db${n}`, [[0, WHITE], [0.6, "#a5b4fc"], [1, "#4338ca"]]), s("M0 0V64", "#cbd5e1", 1), c(0, 80, 16, `url(#db${n})`), s(d.join(""), "#312e81", 0.6, { opacity: 0.6 })];
    } },
    snowball: { box: [-7, -7, 14, 14], parts: () => [c(0, 0, 6, WHITE, { stroke: "#bfdbfe", "stroke-width": 0.8 })] },
    snow1: { box: [-26, -48, 52, 50], parts: () => [c(0, -24, 24, WHITE, { stroke: "#bfdbfe", "stroke-width": 1 })] },
    snow2: { box: [-20, -38, 40, 40], parts: () => [c(0, -18, 18, WHITE, { stroke: "#bfdbfe", "stroke-width": 1 }), c(0, -24, 1.8, INK), c(0, -16, 1.8, INK), c(0, -8, 1.8, INK),
      s("M-17-22L-32-32M17-22L32-34", "#92400e", 1.6)] },
    snow3: { box: [-16, -28, 32, 30], parts: () => [c(0, -13, 13, WHITE, { stroke: "#bfdbfe", "stroke-width": 1 }), c(-4.5, -16, 1.6, INK), c(4.5, -16, 1.6, INK),
      p("M0-13L10-11L0-10Z", ORANGE), s("M-5-7Q0-4 5-7", INK, 1.1)] },
    snowhat: { box: [-14, -20, 28, 22], parts: () => [r(-12, -2, 24, 3, INK, { rx: 1 }), r(-8, -18, 16, 17, INK, { rx: 1.5 }), r(-8, -6, 16, 3, RED)] },
    cake: { box: [-34, -50, 68, 52], parts: (n) => [grad(`ck${n}`, [[0, "#fbcfe8"], [1, "#f9a8d4"]]), r(-30, -22, 60, 22, `url(#ck${n})`, { rx: 3 }),
      r(-22, -38, 44, 17, "#fdf2f8", { rx: 3 }), s("M-30-16C-24-12-18-18-12-14S0-18 6-14 18-18 24-14 30-16 30-16", WHITE, 2),
      r(-12, -48, 3, 10, CYAN, { rx: 1 }), r(-1.5, -48, 3, 10, GOLD, { rx: 1 }), r(9, -48, 3, 10, VIOLET, { rx: 1 }), e(0, 0, 34, 2.4, "rgba(15,23,42,0.35)")] },
    flames: { box: [-14, -60, 28, 14], flat: true, parts: () => [p("M-10.5-48C-13-52-11-55-10.5-58C-9.5-55-8-52-10.5-48Z", GOLD),
      p("M0-48C-2.5-52-0.5-55 0-58C1-55 2.5-52 0-48Z", GOLD), p("M10.5-48C8-52 10-55 10.5-58C11.5-55 13-52 10.5-48Z", GOLD),
      c(-10.5, -51, 1.2, WHITE), c(0, -51, 1.2, WHITE), c(10.5, -51, 1.2, WHITE)] },
    pumpkin: { box: [-24, -38, 48, 40], parts: (n) => [rgrad(`pk${n}`, [[0, "#fdba74"], [0.7, ORANGE], [1, "#9a3412"]]), s("M0-30C0-34 3-36 5-37", GREEN, 2.6),
      e(-9, -15, 12, 15, `url(#pk${n})`), e(9, -15, 12, 15, `url(#pk${n})`), e(0, -15, 11, 15.5, `url(#pk${n})`),
      p("M-11-20L-5-20L-8-25Z", "#fde047"), p("M11-20L5-20L8-25Z", "#fde047"), p("M-12-10C-6-4 6-4 12-10L8-9L6-6L3-9L0-6L-3-9L-6-6L-8-9Z", "#fde047")] },
    santahat: { box: [-28, -40, 56, 44], parts: () => [p("M-22-4C-18-24-6-36 10-34C18-33 22-28 24-22C18-26 12-26 8-22C10-14 12-8 16-4Z", RED),
      r(-26, -8, 44, 9, WHITE, { rx: 4.5 }), c(24, -20, 5, WHITE)] },
    flower1: { box: [-10, -36, 20, 38], parts: () => [s("M0 0C-1-10 1-18 0-26", GREEN, 1.6), e(-4, -10, 4, 1.8, GREEN, { transform: "rotate(-30 -4 -10)" }), ...flowerPart(0, -28, PINK, GOLD)] },
    flower2: { box: [-10, -30, 20, 32], parts: () => [s("M0 0C1-8-1-14 0-20", GREEN, 1.6), e(4, -8, 4, 1.8, GREEN, { transform: "rotate(30 4 -8)" }), ...flowerPart(0, -22, GOLD, ORANGE)] },
    flower3: { box: [-10, -40, 20, 42], parts: () => [s("M0 0C-1-12 1-22 0-30", GREEN, 1.6), ...flowerPart(0, -32, "#a78bfa", WHITE)] },
    leafpile: { box: [-50, -26, 100, 28], parts: () => [p("M-46 0C-40-14-24-22-6-22C14-22 34-16 46 0Z", "#c2410c"),
      p("M-30-10l6-4 4 6zM-8-18l7-2 1 7zM12-14l6 2-3 6zM28-8l7-1-2 6zM-18-6l5-4 4 5z", GOLD), p("M-40-4l6-3 3 5zM0-8l6-3 2 6zM20-4l6-2-1 6z", "#ea580c")] },
    popper: { box: [-10, -26, 20, 28], parts: (n) => [grad(`pp${n}`, [[0, GOLD], [1, PINK]]), p("M-4 0L4 0L9-22L-9-22Z", `url(#pp${n})`, { stroke: WHITE, "stroke-width": 0.8 }),
      s("M-7-14L7-12M-8-6L6-4", WHITE, 1, { opacity: 0.7 })] },
    sign: { box: [-40, -30, 80, 32], parts: () => [r(-38, -28, 76, 24, "rgba(13,18,48,0.92)", { rx: 6, stroke: BLUE, "stroke-width": 1.4 })] },
  };

  // ------------------------------------------------------------------ effects
  // Small one-shot effects (tricks.css animates each and the actor removes it).
  const FX = {
    note: { box: [-8, -14, 16, 18], parts: () => [s("M3-12V2", "#c4b5fd", 1.6), s("M3-12C6-10 8-9 8-6", "#c4b5fd", 1.6), e(0, 2, 3.4, 2.6, "#c4b5fd", { transform: "rotate(-20 0 2)" })] },
    zzz: { box: [-8, -8, 16, 16], parts: () => [t(0, 6, "z", 15, "#a5b4fc")] },
    qmark: { box: [-8, -12, 16, 20], parts: () => [t(0, 7, "?", 20, GOLD)] },
    bang: { box: [-6, -12, 12, 20], parts: () => [t(0, 7, "!", 21, "#fb7185")] },
    heart: { box: [-10, -10, 20, 16], parts: () => [p(heartPath(0, 0, 1), PINK, { stroke: "#fbcfe8", "stroke-width": 0.6 })] },
    confetti: { box: [-40, -40, 80, 80], parts: () => {
      const cols = [PINK, GOLD, CYAN, VIOLET, GREEN, ORANGE, WHITE];
      const out = [];
      for (let i = 0; i < 18; i += 1) {
        const a = (Math.PI * 2 * i) / 18 + (i % 3) * 0.2;
        const d = 12 + (i * 7) % 24;
        out.push(r((Math.cos(a) * d).toFixed(1), (Math.sin(a) * d).toFixed(1), 3, 5, cols[i % cols.length],
          { transform: `rotate(${(i * 37) % 180} ${(Math.cos(a) * d).toFixed(1)} ${(Math.sin(a) * d).toFixed(1)})` }));
      }
      return out;
    } },
    burst: { box: [-40, -40, 80, 80], parts: () => {
      const d = [];
      const dots = [];
      for (let i = 0; i < 14; i += 1) {
        const a = (Math.PI * 2 * i) / 14;
        d.push(`M${(Math.cos(a) * 10).toFixed(1)} ${(Math.sin(a) * 10).toFixed(1)}L${(Math.cos(a) * 30).toFixed(1)} ${(Math.sin(a) * 30).toFixed(1)}`);
        dots.push(c((Math.cos(a) * 34).toFixed(1), (Math.sin(a) * 34).toFixed(1), 2.2, i % 2 ? GOLD : PINK));
      }
      return [s(d.join(""), "#fde68a", 1.8), ...dots];
    } },
    burst2: { box: [-40, -40, 80, 80], parts: () => {
      const d = [];
      const dots = [];
      for (let i = 0; i < 12; i += 1) {
        const a = (Math.PI * 2 * i) / 12 + 0.2;
        d.push(`M${(Math.cos(a) * 8).toFixed(1)} ${(Math.sin(a) * 8).toFixed(1)}L${(Math.cos(a) * 28).toFixed(1)} ${(Math.sin(a) * 28).toFixed(1)}`);
        dots.push(c((Math.cos(a) * 32).toFixed(1), (Math.sin(a) * 32).toFixed(1), 2.4, i % 2 ? CYAN : VIOLET));
      }
      return [s(d.join(""), "#a5f3fc", 1.8), ...dots];
    } },
    flash: { box: [-50, -50, 100, 100], parts: (n) => [rgrad(`fl${n}`, [[0, WHITE, 1], [0.4, WHITE, 0.85], [1, WHITE, 0]]), c(0, 0, 48, `url(#fl${n})`)] },
    ripple: { box: [-20, -20, 40, 40], parts: () => [c(0, 0, 16, "none", { stroke: "#bae6fd", "stroke-width": 2 }), c(0, 0, 9, "none", { stroke: "#e0f2fe", "stroke-width": 1.4 })] },
    splat: { box: [-16, -10, 32, 20], parts: () => [p("M-12 4C-14-2-6-4-6-8C-3-4 0-10 3-6C6-10 10-4 8 0C14 0 14 6 8 6C4 8-6 8-12 4Z", WHITE, { stroke: "#bfdbfe", "stroke-width": 0.8 })] },
    drop: { box: [-5, -8, 10, 14], parts: () => [p("M0-7C3-2 4 1 4 2.5A4 4 0 0 1-4 2.5C-4 1-3-2 0-7Z", "#7dd3fc", { stroke: "#e0f2fe", "stroke-width": 0.6 })] },
    rain: { box: [-3, -10, 6, 14], flat: true, parts: () => [s("M0-8L-1.6 2", "#93c5fd", 1.6, { opacity: 0.9 })] },
    flake: { box: [-7, -7, 14, 14], flat: true, parts: () => [s("M0-6V6M-5.2-3L5.2 3M-5.2 3L5.2-3", WHITE, 1.2), c(0, 0, 1.2, WHITE)] },
    leaf: { box: [-8, -6, 16, 12], parts: () => [p("M-7 0C-4-6 4-6 7 0C4 6-4 6-7 0Z", ORANGE, { stroke: "#9a3412", "stroke-width": 0.6 }), s("M-6 0H6", "#9a3412", 0.6)] },
    smoke: { box: [-10, -10, 20, 20], flat: true, parts: () => [c(-3, 2, 5, "rgba(203,213,225,0.55)"), c(3, -2, 6, "rgba(226,232,240,0.5)")] },
    pop: { box: [-18, -18, 36, 36], flat: true, parts: () => [s("M0-16V-8M0 8V16M-16 0H-8M8 0H16M-11-11L-6-6M11-11L6-6M-11 11L-6 6M11 11L6 6", PINK, 2)] },
    spray: { box: [-6, -14, 30, 28], flat: true, parts: () => [c(4, -6, 1.6, "#bae6fd"), c(9, 0, 1.4, "#bae6fd"), c(14, -9, 1.2, "#e0f2fe"), c(18, 3, 1.6, "#bae6fd"),
      c(12, 8, 1.2, "#e0f2fe"), c(21, -4, 1.1, "#bae6fd")] },
    star: { box: [-9, -9, 18, 18], parts: () => [p(starPath(0, 0, 8), GOLD, { stroke: "#fef3c7", "stroke-width": 0.6 })] },
    rainbow: { box: [-14, -14, 28, 28], flat: true, parts: () => [c(0, 0, 12, "#f87171", { opacity: 0.8 }), c(0, 0, 10, "#fbbf24", { opacity: 0.85 }), c(0, 0, 8, "#4ade80", { opacity: 0.85 }),
      c(0, 0, 6, "#60a5fa", { opacity: 0.9 }), c(0, 0, 4, "#a78bfa")] },
    steam: { box: [-8, -16, 16, 18], flat: true, parts: () => [s("M-3 0C-6-4 0-6-3-10C-5-13-2-15-2-16M3 0C0-4 6-6 3-10", "rgba(226,232,240,0.8)", 1.2)] },
    blush: { box: [-26, -4, 52, 8], flat: true, parts: () => [e(-18, 0, 6, 2.6, "rgba(244,114,182,0.7)"), e(18, 0, 6, 2.6, "rgba(244,114,182,0.7)")] },
    swoosh: { box: [-40, -16, 80, 32], flat: true, parts: () => [s("M-36 4C-20 14 20 14 36 4M-28-6C-12 2 12 2 28-6", "#a5f3fc", 1.8, { opacity: 0.8 })] },
    bubbles: { box: [-8, -14, 16, 18], flat: true, parts: () => [c(0, 0, 3, "none", { stroke: "#bae6fd", "stroke-width": 1 }), c(4, -7, 2, "none", { stroke: "#e0f2fe", "stroke-width": 0.8 }),
      c(-2, -11, 1.4, "none", { stroke: "#e0f2fe", "stroke-width": 0.8 })] },
    spark: { box: [-10, -10, 20, 20], flat: true, parts: () => [s("M0 0L-8-6M0 0L-9 2M0 0L-5 8", GOLD, 1.4)] },
    streak: { box: [-30, -4, 60, 8], flat: true, parts: (n) => [grad(`sr${n}`, [[0, "rgba(255,255,255,0)"], [0.5, "rgba(255,255,255,0.9)"], [1, "rgba(255,255,255,0)"]], { x2: 1, y2: 0 }),
      r(-30, -2, 60, 4, `url(#sr${n})`, { rx: 2 })] },
    ice: { box: [-9, -9, 18, 18], flat: true, parts: () => [s("M0-8V8M-7-4L7 4M-7 4L7-4", "#bae6fd", 1.4), s("M0-8L-2-6M0-8L2-6M0 8L-2 6M0 8L2 6", "#e0f2fe", 1)] },
    heat: { box: [-12, -16, 24, 18], flat: true, parts: () => [s("M-6 0C-9-4-3-6-6-10C-8-13-5-15-5-16M2 0C-1-4 5-6 2-10C0-13 3-15 3-16M9 0C6-4 12-6 9-10", "rgba(251,146,60,0.75)", 1.4)] },
    bat: { box: [-12, -6, 24, 12], parts: () => [p("M0-2C-2-4-5-4-6-2C-8-4-11-3-12 0C-9 0-7 2-6 3C-4 1-2 1 0 3C2 1 4 1 6 3C7 2 9 0 12 0C11-3 8-4 6-2C5-4 2-4 0-2Z", "#312e81", { stroke: "#a78bfa", "stroke-width": 0.6 })] },
    petal: { box: [-5, -4, 10, 8], parts: () => [e(0, 0, 4, 2.4, "#fbcfe8", { stroke: PINK, "stroke-width": 0.5 })] },
  };

  let made = 0;
  function build(doc, tag, a) {
    const n = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a || {})) {
      if (k === "_kids") for (const kid of v) n.appendChild(build(doc, kid[0], kid[1]));
      else if (k === "_text") n.textContent = v;
      else n.setAttribute(k, String(v));
    }
    return n;
  }

  // An <svg> of a drawing (or the owner's picture).
  function draw(doc, def) {
    made += 1;
    if (def.picture) {
      const img = doc.createElement("img");
      img.className = "pt-pic";
      img.setAttribute("alt", "");
      img.setAttribute("draggable", "false");
      img.setAttribute("src", `../../assets/props/${def.picture}.webp`);
      return img;
    }
    const parts = def.parts(made);
    const defs = parts.filter((q) => /Gradient$/.test(q[0]));
    const kids = parts.filter((q) => !/Gradient$/.test(q[0]));
    const el = build(doc, "svg", { viewBox: "-50 -50 100 100", "aria-hidden": "true", class: def.flat ? "pt pa-flat" : "pt" });
    if (defs.length) el.appendChild(build(doc, "defs", { _kids: defs }));
    for (const q of kids) el.appendChild(build(doc, q[0], q[1]));
    return el;
  }

  const kindOf = (el, prefix) => {
    for (const cls of el.classList) if (cls.startsWith(prefix)) return cls.slice(prefix.length);
    return "";
  };

  // Draw into a prop or effect box the actor just made, if it's one of ours.
  function fill(el) {
    if (!el || !el.classList) return false;
    if (el.classList.contains("pa-prop") && !el.firstChild) {
      const def = PROPS[kindOf(el, "pa-prop-")];
      if (def) { el.appendChild(draw(el.ownerDocument, def)); return true; }
    } else if (el.classList.contains("pa-fx")) {
      const def = FX[kindOf(el, "pa-fx-")];
      const inner = el.firstChild;
      if (def && inner && !inner.firstChild) { inner.appendChild(draw(el.ownerDocument, def)); return true; }
    }
    return false;
  }

  // Watch the stage: every new prop or effect box of ours gets its drawing
  // before it's painted (mutation callbacks run before the next frame).
  function attach(stage) {
    const MO = stage.ownerDocument.defaultView && stage.ownerDocument.defaultView.MutationObserver;
    const scan = (n) => {
      if (n.nodeType !== 1) return;
      fill(n);
      if (n.querySelectorAll) for (const q of n.querySelectorAll(".pa-prop, .pa-fx")) fill(q);
    };
    if (!MO) return { disconnect() {} };
    const mo = new MO((list) => { for (const m of list) for (const n of m.addedNodes) scan(n); });
    mo.observe(stage, { childList: true, subtree: true });
    return mo;
  }

  // The owner's prop pictures (assets/props/<name>.webp).
  const PICTURES = ["door", "trophy", "crown", "globe", "city-screen", "crystal-city"];
  for (const name of PICTURES) PROPS[name] = { picture: name };

  const api = { PICTURES, PROPS: Object.keys(PROPS), FX: Object.keys(FX), attach, fill, draw: (doc, kind) => (PROPS[kind] || FX[kind] ? draw(doc, PROPS[kind] || FX[kind]) : null) };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotProps = api;
})(typeof window !== "undefined" ? window : globalThis);
