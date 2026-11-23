// Pilot for Mac · tricks.js: the 80 tricks of Pilot for Mac 1.3, each a
// named, choreographed move in a category: dances, sports, fun and tricks,
// moods, playing with the screen, and seasonal ones.
//
// Each is built from the owner's pose pictures (never mirrored: a picture
// that faces one way is only used going that way, or standing still), with
// transforms, springy easing, small props and effects drawn in SVG
// (src/renderer/props.js) and the owner's prop pictures. Every prop fades
// out before the move ends, and the actor removes it. A move first walks
// (or lands) somewhere with room for it, and ends on the floor, standing, so
// the next one links on.
//
// Also here, with no DOM: which tricks fit today (seasonal ones only in their
// season, by the Mac's own date; the morning and night ones only then), and
// the pick for "Always moving" (src/main/life.js), which stays travel-first.
(function (root) {
  "use strict";

  const node = typeof module === "object" && module.exports;
  const M = node ? require("./pilot-motion") : root.PilotMotion;
  const R = node ? require("./roam") : root.PilotRoam;
  const REST = M.REST;

  const CATEGORIES = ["Dances", "Sports", "Fun and Tricks", "Moods", "Screen", "Seasonal"];

  // Where things are in the pose pictures, in robot widths from the point
  // between the feet (x right, y down), measured from the pictures.
  const H = {
    standing: { head: [0, -1.01], eyes: [0, -1.0], top: [0, -1.3], mouth: [0.02, -0.86], near: [0.38, -0.42], far: [-0.38, -0.42], chest: [0, -0.6] },
    wave: { up: [-0.48, -1.58], near: [0.36, -0.42], head: [0.04, -1.0] },
    celebrate: { near: [0.48, -1.0], far: [-0.35, -0.98], top: [0.05, -1.25] },
    catch: { ball: [-0.42, -1.1] },
    throw: { ball: [-0.48, -1.01] },
    baseball: { contact: [-0.2, -0.85] },
    bowling: { ball: [-0.48, -0.25] },
    kick: { ball: [0.42, -0.36] },
    snowball: { ball: [0.42, -1.01] },
    "paper-plane": { near: [0.39, -0.86] },
    knock: { knuckle: [0.36, -0.78] },
    juggle: { near: [0.36, -0.7], far: [-0.36, -0.7] },
    sitting: { head: [0, -0.89], lap: [0.06, -0.32] },
    "arms-crossed": { head: [0, -1.06], top: [0, -1.4] },
    sneeze: { nose: [0.12, -0.9] },
  };
  const spot = (k, g, pose, key) => {
    const a = (H[pose] || H.standing)[key] || H.standing.chest;
    return { x: k.now.x + a[0] * g.u, y: k.now.y + a[1] * g.u };
  };
  // A held prop's place (on the body, from the point between the feet).
  const rel = (g, pose, key) => {
    const a = (H[pose] || H.standing)[key] || H.standing.chest;
    return { x: a[0] * g.u, y: a[1] * g.u };
  };

  // ---------------------------------------------------------------- small builders

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // A pose, with a little squash so the change reads as part of the motion.
  function pose(k, name, fade, ms) {
    return k.to(70, { sy: 0.95, sx: 1.03 }, "out").show(name, fade || 130).to(ms || 260, { sy: 1, sx: 1 }, "springSoft");
  }
  // Bounces on the spot: up (stretched), down (squashed), n times.
  function bounce(k, g, n, ms, h) {
    const y0 = k.now.y;
    for (let i = 0; i < n; i += 1) {
      k.to(ms * 0.45, { y: y0 - g.u * (h || 0.08), sy: 1.05, sx: 0.97 }, "rise").to(ms * 0.55, { y: y0, sy: 0.94, sx: 1.04 }, "fall");
    }
    return k.to(220, { sy: 1, sx: 1 }, "springSoft");
  }
  // Leaning side to side, n times.
  function sway(k, n, deg, ms) {
    for (let i = 0; i < n; i += 1) k.to(ms / 2, { r: deg }, "soft").to(ms / 2, { r: -deg }, "soft");
    return k.to(260, { r: 0 }, "springSoft");
  }
  // Breathing while he waits, so he's never frozen.
  const hold = (k, ms) => k.to(ms / 2, { sy: 1.015, sx: 0.995 }, "soft").to(ms / 2, { sy: 1, sx: 1 }, "soft");
  const say = (k, g, text, dy) => k.fx("bubble", 0, -g.u * (dy || 1.72), { text });
  // Effects scattered over a stretch of time across an area.
  function shower(k, g, kind, n, ms, x0, x1, y0, y1, r) {
    for (let i = 0; i < n; i += 1) {
      k.fxAt(k.t + (ms * i) / n, kind, clamp(x0 + (x1 - x0) * r(), g.left - g.u * 0.5, g.right + g.u * 0.5), y0 + ((y1 === undefined ? y0 : y1) - y0) * r());
    }
    return k;
  }
  // A prop popping in with a spring (from small), or fading out.
  function pop(k, id, at, v, ms) {
    const sx = v.sx === undefined ? 1 : v.sx;
    const sy = v.sy === undefined ? 1 : v.sy;
    k.propAt(id, Math.max(0, at), { r: 0, ...v, o: 0, sx: sx * 0.3, sy: sy * 0.3 });
    return k.propAt(id, Math.max(0, at) + (ms || 380), { o: 1, sx, sy }, "spring");
  }
  function gone(k, id, at, ms) {
    const l = k.propLast(id);
    k.propAt(id, at, {});
    return k.propAt(id, at + (ms || 260), { o: 0, sx: l.sx * 0.8, sy: l.sy * 0.8 }, "in");
  }
  // A prop thrown on an arc (sampled: right speed along it), spinning.
  function fling(k, id, t0, ms, a, b, h, spin, n) {
    const steps = n || Math.max(6, Math.round(ms / 70));
    const r0 = k.propLast(id).r || 0;
    for (let i = 1; i <= steps; i += 1) {
      const u = i / steps;
      k.propAt(id, t0 + ms * u, { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - h * 4 * u * (1 - u), r: r0 + (spin || 0) * u });
    }
    return k;
  }
  // Turning about a point above his feet (a cartwheel, a flip in the air):
  // the feet swing round that point, the picture turns with them.
  function turnAbout(k, ms, c, h, from, to, n, posePick) {
    const steps = n || Math.max(8, Math.round(ms / 50));
    for (let i = 1; i <= steps; i += 1) {
      const u = i / steps;
      const th = from + (to - from) * u;
      const rad = (th * Math.PI) / 180;
      const cx = typeof c.x === "function" ? c.x(u) : c.x;
      const cy = typeof c.y === "function" ? c.y(u) : c.y;
      if (posePick) posePick(th);
      k.to(ms / steps, { x: cx - h * Math.sin(rad), y: cy + h * Math.cos(rad), r: th }, "linear");
    }
    return k;
  }
  // Closer to the glass (bigger), and back.
  const closer = (k, s) => k.to(160, { sy: 0.94 * s, sx: 1.03 * s }, "anticipate").to(420, { sx: s, sy: s }, "spring");
  const back = (k) => k.to(140, { sx: 1.04, sy: 0.94 }, "out").to(380, { sx: 1, sy: 1 }, "springSoft");
  // Up off the floor to height (a hop up), then the caller does the rest.
  function liftTo(k, ms, y) { return k.to(120, { sy: 0.86, sx: 1.08 }, "anticipate").to(ms, { y, sy: 1.08, sx: 0.95 }, "rise").to(160, { sy: 1, sx: 1 }, "soft"); }

  // ---------------------------------------------------------------- the moves

  // Each: id, name, category, the poses it uses, room it needs on each side
  // (robot widths), its season or time of day, and how it goes.
  const LIST = [];
  const add = (cat, id, name, poses, o, run) => LIST.push({ cat, id, name, poses, room: o.room || {}, season: o.season || null,
    time: o.time || null, endRest: Boolean(o.endRest), run });

  // ------------------------------------------------------------ Dances

  add("Dances", "groove", "Groove", ["walk1", "walk2", "laugh", "celebrate"], {}, (k, g, r) => {
    k.sound("tune");
    for (let i = 0; i < 4; i += 1) {
      pose(k, i % 2 ? "walk2" : "walk1", 110, 120);
      k.to(200, { r: i % 2 ? -6 : 6, y: g.floor - g.u * 0.05, sy: 1.04 }, "out").to(220, { y: g.floor, sy: 0.95 }, "fall").to(120, { sy: 1 }, "soft");
      k.fx("note", (i % 2 ? -1 : 1) * g.u * 0.5, -g.u * 1.3);
    }
    pose(k, "laugh", 120);
    bounce(k, g, 2, 300, 0.06);
    R.jump(k, g, { h: g.u * 0.35, pose: "celebrate", land: "standing" });
  });

  add("Dances", "spin-dance", "Spin Dance", ["spin", "standing"], {}, (k, g) => {
    k.sound("tune");
    R.squash(k, 0.12, 200);
    k.to(140, { sy: 0.86, sx: 1.08 }, "anticipate").show("spin", 90);
    k.sound("whoosh", 0);
    const c = { x: k.now.x, y: g.floor - g.u * 0.75 };
    turnAbout(k, 900, c, g.u * 0.75, 0, 720);
    k.fx("swoosh", 0, -g.u * 0.7).set({ r: 0 });
    k.show("standing", 120).to(90, { sy: 0.88, sx: 1.08 }, "out").to(380, { sy: 1, sx: 1 }, "spring");
    k.fx("sparkle", g.u * 0.4, -g.u * 1.3);
  });

  add("Dances", "robot-dance", "Robot Dance", ["point", "arms-crossed", "standing", "shy"], { room: { left: 0.6, right: 0.6 } }, (k, g) => {
    k.sound("tune");
    const x0 = k.now.x;
    const moves = [["point", 8, 0.12], ["arms-crossed", -8, -0.12], ["standing", 0, 0.12], ["point", -10, -0.12], ["shy", 6, 0], ["arms-crossed", 0, 0]];
    for (const [p, deg, dx] of moves) {
      k.show(p, 60).to(110, { r: deg, x: x0 + g.u * dx, sy: 0.97 }, "out").to(90, { sy: 1 }, "out").wait(240);
    }
    k.show("standing", 120).to(300, { r: 0, x: x0 }, "spring");
  });

  add("Dances", "moonwalk", "Moonwalk Slide", ["standing", "point"], { room: { left: 2.4 } }, (k, g) => {
    k.sound("tune");
    k.to(200, { r: 4 }, "soft");
    const x0 = k.now.x;
    // Gliding left, facing the camera: heels pop on every slide.
    for (let i = 0; i < 6; i += 1) {
      k.to(220, { x: x0 - g.u * 0.35 * (i + 0.6), sy: 0.97, sx: 1.02 }, "linear").to(160, { x: x0 - g.u * 0.35 * (i + 1), sy: 1.02, sx: 0.99 }, "linear");
      if (i % 2) k.fx("dust", g.u * 0.1, 0, { dir: 1 });
    }
    const c = { x: k.now.x, y: g.floor - g.u * 0.75 };
    k.sound("whoosh");
    turnAbout(k, 420, c, g.u * 0.75, 4, 364, 10);
    k.set({ r: 0 });
    pose(k, "point", 90, 320).wait(380).fx("sparkle", g.u * 0.35, -g.u * 1.35);
    k.show("standing", 130).to(200, { sy: 1 }, "soft");
  });

  add("Dances", "victory-dance", "Victory Dance", ["celebrate", "confetti", "standing"], { room: { right: 1.2 } }, (k, g) => {
    k.prop("cup", "trophy");
    for (let i = 0; i < 3; i += 1) {
      R.jump(k, g, { h: g.u * (0.3 + 0.1 * i), pose: "celebrate", ms: 460, land: "celebrate" });
      k.fx("confetti", 0, -g.u * 1.3);
    }
    k.sound("applause");
    pop(k, "cup", k.t, { x: k.now.x + g.u * 0.85, y: g.floor });
    k.show("confetti", 120);
    bounce(k, g, 3, 320, 0.05);
    k.fx("sparkle", g.u * 0.85, -g.u * 0.8);
    hold(k, 500);
    gone(k, "cup", k.t);
    k.show("standing", 130).wait(260);
  });

  add("Dances", "disco", "Disco Night", ["point", "standing"], {}, (k, g, r) => {
    k.sound("tune");
    k.prop("ball", "discoball");
    const bx = k.now.x + g.u * 0.2;
    k.propAt("ball", 0, { x: bx, y: -g.u * 1, o: 1 }).propAt("ball", 700, { y: Math.max(0, g.floor - g.u * 3.2) }, "spring");
    k.wait(400);
    for (let i = 0; i < 4; i += 1) {
      k.show(i % 2 ? "standing" : "point", 80).to(200, { r: i % 2 ? -10 : 10, sy: 0.95 }, "out").to(220, { sy: 1.03 }, "soft");
      k.fx("star", (r() - 0.5) * g.u * 2, -g.u * (1 + r()));
      k.propAt("ball", k.t, { r: (i + 1) * 45 }, "soft");
    }
    k.to(260, { r: 0, sy: 1 }, "springSoft").show("standing", 120);
    k.propAt("ball", k.t, {}).propAt("ball", k.t + 500, { y: -g.u * 1.2, o: 0 }, "in");
    k.wait(300);
  });

  add("Dances", "twist", "The Twist", ["standing", "laugh"], {}, (k, g) => {
    k.sound("tune");
    for (let i = 0; i < 6; i += 1) {
      const low = i < 3 ? i : 5 - i;
      k.to(160, { r: i % 2 ? -12 : 12, sy: 1 - 0.05 * low, sx: 1 + 0.03 * low }, "soft");
    }
    k.to(260, { r: 0, sy: 1, sx: 1 }, "springSoft");
    pose(k, "laugh", 120);
    bounce(k, g, 2, 260, 0.05);
    k.show("standing", 130);
  });

  add("Dances", "tap-dance", "Tap Dance", ["walk1", "standing", "celebrate"], { room: { left: 0.5, right: 0.5 } }, (k, g) => {
    k.sound("tune");
    const x0 = k.now.x;
    for (let i = 0; i < 8; i += 1) {
      // A tap to the right on walk1 (it faces right), back on the camera-facing picture.
      // (1.5.1: the tap's shift happens as the picture changes, so the foot doesn't slide.)
      k.show(i % 2 ? "standing" : "walk1", 70).set({ x: x0 + g.u * 0.06 * (i % 2 ? -1 : 1) });
      k.to(110, { y: g.floor - g.u * 0.04, sy: 1.03 }, "out").to(110, { y: g.floor, sy: 0.96 }, "in");
      k.fx("spark", g.u * 0.15 * (i % 2 ? -1 : 1), -g.u * 0.02);
    }
    k.to(80, { x: x0 }, "out");
    R.jump(k, g, { h: g.u * 0.3, pose: "celebrate", land: "standing" });
  });

  add("Dances", "sway", "Concert Sway", ["wave", "love", "standing"], {}, (k, g) => {
    k.sound("tune");
    pose(k, "wave", 140);
    for (let i = 0; i < 3; i += 1) {
      k.to(420, { r: 8 }, "soft").fx("note", g.u * 0.5, -g.u * 1.5).to(420, { r: -8 }, "soft").fx("heart", -g.u * 0.4, -g.u * 1.4);
    }
    k.to(300, { r: 0 }, "springSoft");
    pose(k, "love", 140);
    hold(k, 700);
    k.show("standing", 140);
  });

  // ------------------------------------------------------------ Sports

  add("Sports", "basketball", "Basketball Shot", ["standing", "celebrate"], { room: { right: 2.8 } }, (k, g) => {
    k.prop("hoop", "hoop").prop("ball", "basketball");
    const hx = k.now.x + g.u * 2.3;
    pop(k, "hoop", 0, { x: hx, y: g.floor });
    const rim = { x: hx, y: g.floor - g.u * 1.61 };
    k.wait(450);
    // Crouch with the ball, jump, release at the top.
    k.propAt("ball", k.t, { x: k.now.x + g.u * 0.3, y: g.floor - g.u * 0.5, o: 1 });
    k.to(200, { sy: 0.84, sx: 1.1 }, "anticipate");
    k.propAt("ball", k.t, { x: k.now.x + g.u * 0.25, y: g.floor - g.u * 0.75 });
    k.show("celebrate", 80);
    const t0 = k.t;
    R.arc(k, 520, { x: k.now.x, y: g.floor }, g.u * 0.45, { stretch: 1 });
    const rel0 = { x: k.now.x + g.u * 0.1, y: g.floor - g.u * 1.7 };
    k.propAt("ball", t0 + 240, { x: rel0.x, y: rel0.y - g.u * 0.4 }, "rise");
    fling(k, "ball", t0 + 240, 900, { x: rel0.x, y: rel0.y - g.u * 0.4 }, { x: rim.x, y: rim.y - g.u * 0.08 }, g.u * 1.0, 300);
    const swish = t0 + 1140;
    k.propAt("ball", swish + 200, { y: rim.y + g.u * 0.35 }, "fall").propAt("ball", swish + 480, { y: g.floor - g.u * 0.08 }, "fall")
      .propAt("ball", swish + 700, { y: g.floor - g.u * 0.35, x: rim.x - g.u * 0.2 }, "rise").propAt("ball", swish + 900, { y: g.floor - g.u * 0.08 }, "fall");
    k.fxAt(swish, "sparkle", rim.x, rim.y).fxAt(swish + 80, "star", rim.x + g.u * 0.2, rim.y - g.u * 0.2);
    k.to(80, { sy: 0.84, sx: 1.12 }, "out").to(360, { sy: 1, sx: 1 }, "spring");
    k.wait(Math.max(0, swish - k.t));
    k.sound("applause");
    R.jump(k, g, { h: g.u * 0.3, pose: "celebrate", land: "celebrate" });
    k.wait(500).show("standing", 130);
    gone(k, "ball", k.t);
    gone(k, "hoop", k.t + 100, 360);
    k.wait(460);
  });

  add("Sports", "baseball", "Home Run", ["standing", "baseball"], { room: { left: 1.2 } }, (k, g) => {
    k.prop("ball", "baseball");
    pose(k, "baseball", 140);
    sway(k, 1, 3, 500);
    // The pitch comes in from the left; the swing sends it high and away.
    const c = spot(k, g, "baseball", "contact");
    const from = { x: g.left - g.u * 0.4, y: g.floor - g.u * 0.9 };
    const t0 = k.t;
    k.propAt("ball", t0, { x: from.x, y: from.y, o: 1 });
    fling(k, "ball", t0, 600, from, c, g.u * 0.15, 0, 8);
    k.wait(480).to(60, { r: 4 }, "out");
    k.show("standing", 50).to(110, { r: -12, sx: 1.04 }, "out").fx("swoosh", -g.u * 0.2, -g.u * 0.8).sound("crack");
    const hit = t0 + 600;
    fling(k, "ball", hit, 900, c, { x: g.left - g.u * 0.2, y: Math.max(g.u * 0.2, g.floor - g.u * 4.5) }, g.u * 1.4, 0, 10);
    k.fxAt(hit, "star", c.x, c.y);
    k.propAt("ball", hit + 900, { o: 0 });
    k.to(360, { r: 0, sx: 1 }, "spring");
    say(k, g, "Home run!");
    k.sound("applause");
    R.jump(k, g, { h: g.u * 0.25, pose: "celebrate", land: "standing" });
  });

  add("Sports", "golf", "Golf Putt", ["standing", "celebrate"], { room: { right: 2.6 } }, (k, g) => {
    k.prop("flag", "flag").prop("ball", "golfball").prop("club", "putter", "body");
    const hole = k.now.x + g.u * 2.2;
    pop(k, "flag", 0, { x: hole, y: g.floor });
    const h = rel(g, "standing", "near");
    pop(k, "club", 100, { x: h.x, y: h.y, r: 10 });
    const bx = k.now.x + g.u * 0.55;
    pop(k, "ball", 200, { x: bx, y: g.floor - g.u * 0.035 });
    k.to(300, { r: 6 }, "soft").wait(200);
    // Back, and a gentle tap.
    k.propAt("club", k.t, {}).propAt("club", k.t + 500, { r: 38 }, "soft");
    k.to(500, { r: 3 }, "soft");
    const tap = k.t + 160;
    k.propAt("club", tap, { r: -18 }, "in").propAt("club", tap + 400, { r: 0 }, "springSoft");
    k.to(160, { r: -3 }, "in").to(300, { r: 0 }, "springSoft");
    k.sound("pop", -150);
    k.propAt("ball", tap, { x: bx }).propAt("ball", tap + 1300, { x: hole - g.u * 0.02, r: 720 }, "out");
    k.propAt("ball", tap + 1420, { y: g.floor + g.u * 0.02, o: 0, sx: 0.4, sy: 0.4 }, "in");
    k.fxAt(tap + 1400, "sparkle", hole, g.floor - g.u * 0.3);
    k.wait(Math.max(0, tap + 1450 - k.t));
    k.sound("applause");
    gone(k, "club", k.t);
    R.jump(k, g, { h: g.u * 0.3, pose: "celebrate", land: "standing" });
    gone(k, "flag", k.t, 360);
    k.wait(380);
  });

  add("Sports", "bowling", "Bowling Strike", ["standing", "bowling"], { room: { left: 3.4 } }, (k, g) => {
    const pins = ["p1", "p2", "p3"];
    for (const id of pins) k.prop(id, "pin");
    k.prop("ball", "bowlingball");
    const px = k.now.x - g.u * 3.1;
    pins.forEach((id, i) => pop(k, id, 100 * i, { x: px - g.u * 0.16 * i, y: g.floor - g.u * 0.02 * i }));
    k.to(260, { r: 5 }, "soft");
    pose(k, "bowling", 140);
    k.to(320, { r: -6, x: k.now.x - g.u * 0.1 }, "out");
    // He lets go: the picture's ball becomes the rolling one.
    const b = spot(k, g, "bowling", "ball");
    const t0 = k.t;
    k.show("standing", 90);
    k.propAt("ball", t0, { x: b.x, y: b.y, o: 1 }).propAt("ball", t0 + 200, { y: g.floor - g.u * 0.09 }, "fall");
    k.propAt("ball", t0 + 1400, { x: px + g.u * 0.1, r: -900 }, "linear");
    k.sound("thwack", 1400);
    pins.forEach((id, i) => {
      k.propAt(id, t0 + 1400, {}).propAt(id, t0 + 2000, { x: px - g.u * (0.5 + 0.4 * i), y: g.floor - g.u * (0.6 - 0.15 * i), r: -120 - 60 * i }, "out")
        .propAt(id, t0 + 2400, { y: g.floor - g.u * 0.05, o: 0 }, "fall");
    });
    k.propAt("ball", t0 + 2000, { x: px - g.u * 0.7, o: 0, r: -1300 }, "out");
    k.fxAt(t0 + 1400, "star", px, g.floor - g.u * 0.3);
    k.to(400, { r: 0 }, "springSoft").wait(Math.max(0, t0 + 1500 - k.t));
    say(k, g, "Strike!");
    k.sound("applause");
    R.jump(k, g, { h: g.u * 0.3, pose: "celebrate", land: "standing" });
    k.wait(Math.max(0, t0 + 2450 - k.t));
  });

  add("Sports", "skateboard", "Skateboard Ride", ["standing", "celebrate"], { room: { left: 1.6, right: 1.6 } }, (k, g, r) => {
    k.prop("board", "skateboard", "body");
    const dir = k.now.x - g.left > g.right - k.now.x ? -1 : 1;
    const lift = g.u * 0.12;
    pop(k, "board", k.t, { x: 0, y: 0 });
    k.propAt("board", k.t + 380, { y: 0 });
    // Hop on (the board is under his feet from here: he rides a little higher).
    R.jump(k, g, { h: g.u * 0.3, y: g.floor - lift, dust: false });
    const x0 = k.now.x;
    k.to(500, { x: x0 + dir * g.u * 0.9, r: dir * 4 }, "out").to(500, { x: x0 + dir * g.u * 1.5 }, "linear");
    // An ollie.
    k.to(120, { sy: 0.88, sx: 1.06 }, "anticipate");
    R.arc(k, 520, { x: x0 + dir * g.u * 2.3, y: g.floor - lift }, g.u * 0.4, { r: dir * 6 });
    k.sound("swish", -400);
    k.to(80, { sy: 0.9, sx: 1.06 }, "out").to(500, { x: x0 + dir * g.u * 2.7, sy: 1, sx: 1, r: 0 }, "out");
    k.fx("dust", -dir * g.u * 0.3, 0, { dir });
    R.jump(k, g, { h: g.u * 0.25, y: g.floor, x: k.now.x + dir * g.u * 0.2, pose: "celebrate", land: "standing" });
    k.propAt("board", k.t - 600, {});
    gone(k, "board", k.t - 600, 200);
  });

  add("Sports", "surfing", "Surfing", ["surf", "standing"], { room: { right: 3.2 } }, (k, g) => {
    k.prop("wave", "wave");
    const x0 = k.now.x;
    k.propAt("wave", 0, { x: x0 - g.u * 0.4, y: g.floor + g.u * 0.9, o: 1 }).propAt("wave", 700, { y: g.floor + g.u * 0.05 }, "out");
    k.wait(400).sound("whoosh");
    R.jump(k, g, { h: g.u * 0.35, y: g.floor - g.u * 0.3, pose: "surf", dust: false });
    const t0 = k.t;
    for (let i = 1; i <= 8; i += 1) {
      const u = i / 8;
      k.to(260, { x: x0 + g.u * 2.8 * u, y: g.floor - g.u * (0.3 + 0.12 * Math.sin(u * Math.PI * 3)), r: 4 * Math.sin(u * Math.PI * 2) }, "soft");
    }
    k.propAt("wave", t0, { x: x0 - g.u * 0.4 }).propAt("wave", k.t, { x: x0 + g.u * 2.5 }, "linear");
    k.fx("spray", 0, 0);
    R.jump(k, g, { h: g.u * 0.25, y: g.floor, x: k.now.x + g.u * 0.2, land: "standing" });
    k.propAt("wave", k.t - 500, {}).propAt("wave", k.t, { y: g.floor + g.u * 0.9, o: 0 }, "in");
  });

  add("Sports", "skiing", "Skiing", ["fly", "ski", "snowboard", "standing"], { room: { right: 3.4 } }, (k, g, r) => {
    k.prop("slope", "slope");
    const left = Math.max(g.left, k.now.x - g.u * 0.2);
    if (Math.abs(left - k.now.x) > 2) R.steps(k, g, left, false);
    const x0 = k.now.x;
    const hgt = Math.min(1.5, (g.floor - g.top) / g.u - 0.2);
    pop(k, "slope", k.t, { x: x0 - g.u * 0.1, y: g.floor, sx: 1, sy: hgt / 1.5 });
    // Up to the top of the slope, then down it.
    R.flyTo(k, g, { x: x0, y: g.floor - g.u * hgt }, true);
    const board = r() < 0.5 ? "ski" : "snowboard";
    k.show(board, 100).heading(1);
    k.sound("whoosh");
    const top = k.now;
    const end = { x: x0 - g.u * 0.1 + g.u * 3, y: g.floor };
    for (let i = 1; i <= 10; i += 1) {
      const u = i / 10;
      const e = u * u * (1.6 - 0.6 * u); // speeding up, easing out at the bottom
      k.to(150, { x: top.x + (end.x - top.x) * e, y: top.y + (end.y - top.y) * e, r: 18 * (1 - u * 0.6) }, "linear");
      if (i % 3 === 0) k.fx("spray", -g.u * 0.2, 0);
    }
    k.to(300, { x: end.x + g.u * 0.25, r: -6 }, "out").fx("spray", 0, 0).heading(0);
    k.show("standing", 130).to(300, { r: 0 }, "spring");
    gone(k, "slope", k.t, 400);
    k.wait(300);
  });

  add("Sports", "keepy-uppy", "Keepy-Uppy", ["standing", "kick"], { room: { right: 1.6 } }, (k, g) => {
    k.prop("ball", "soccer");
    const foot = { x: k.now.x + g.u * 0.25, y: g.floor - g.u * 0.12 };
    k.propAt("ball", 0, { x: foot.x, y: foot.y, o: 0 }).propAt("ball", 200, { o: 1 });
    k.wait(200);
    // Taps: foot, knee, foot, head, foot.
    const heights = [0.9, 0.6, 1.1, 1.5, 0.8];
    for (const hgt of heights) {
      const t0 = k.t;
      k.propAt("ball", t0 + 300, { y: foot.y - g.u * hgt }, "rise").propAt("ball", t0 + 600, { y: foot.y }, "fall");
      k.to(120, { sy: 0.95, r: 3 }, "out").to(480, { sy: 1, r: 0 }, "springSoft");
      k.sound("kick", 0);
      k.fxAt(t0, "spark", foot.x, foot.y);
    }
    // The big kick: the picture's ball becomes the flying one.
    k.show("kick", 80).propAt("ball", k.t, { o: 0 });
    k.to(100, { r: 4 }, "in");
    const b = spot(k, g, "kick", "ball");
    k.sound("kick");
    k.propAt("ball", k.t, { x: b.x, y: b.y, o: 1 });
    fling(k, "ball", k.t, 800, b, { x: b.x + g.u * 1.4, y: g.floor - g.u * 1.6 }, g.u * 0.6, 720);
    k.propAt("ball", k.t + 800, { o: 0 });
    k.to(260, { r: 0 }, "springSoft").wait(300).show("standing", 130).wait(260);
  });

  add("Sports", "goalkeeper", "Goalkeeper Dive", ["standing", "fly", "celebrate"], { room: { left: 1.4, right: 1.4 } }, (k, g) => {
    k.prop("goal", "goalfront").prop("ball", "soccer");
    const x0 = k.now.x;
    pop(k, "goal", 0, { x: x0, y: g.floor });
    k.wait(400).to(220, { sy: 0.9, sx: 1.05 }, "soft");
    const from = { x: g.right + g.u * 0.4, y: g.floor - g.u * 0.3 };
    const save = { x: x0 - g.u * 0.75, y: g.floor - g.u * 0.75 };
    const t0 = k.t;
    k.propAt("ball", t0, { x: from.x, y: from.y, o: 1 });
    fling(k, "ball", t0, 700, from, save, g.u * 0.3, -540);
    k.sound("kick", 0);
    // The dive to his left, arms out.
    k.wait(250).to(120, { sy: 0.84, sx: 1.1 }, "anticipate").show("fly", 60);
    k.to(330, { x: x0 - g.u * 0.5, y: g.floor - g.u * 0.35, r: -70 }, "out");
    k.propAt("ball", t0 + 700, {}).propAt("ball", t0 + 1000, { x: save.x + g.u * 0.1, y: save.y + g.u * 0.25 }, "out");
    k.to(300, { y: g.floor - g.u * 0.05, x: x0 - g.u * 0.62 }, "fall").fx("dust", 0, 0, { dir: -1 });
    k.wait(300).to(300, { x: x0 - g.u * 0.3, y: g.floor, r: 0 }, "springSoft").show("celebrate", 120);
    k.propAt("ball", k.t - 300, {}).propAt("ball", k.t, { x: k.now.x + g.u * 0.05, y: g.floor - g.u * 1.25 }, "out");
    k.sound("applause");
    say(k, g, "Saved!");
    bounce(k, g, 2, 320, 0.08);
    gone(k, "ball", k.t);
    k.show("standing", 130);
    gone(k, "goal", k.t, 360);
    R.steps(k, g, x0, false);
  });

  add("Sports", "high-jump", "High Jump", ["run1", "run2", "flip", "land", "standing"], { room: { right: 3.6 } }, (k, g) => {
    k.prop("bar", "highbar").prop("mat", "mat");
    const x0 = k.now.x;
    const bar = x0 + g.u * 2.2;
    pop(k, "bar", 0, { x: bar, y: g.floor });
    pop(k, "mat", 150, { x: bar + g.u * 0.9, y: g.floor });
    k.wait(450);
    R.steps(k, g, bar - g.u * 0.7, true);
    // Up and over the bar, turning over (the flip picture at the top).
    k.to(110, { sy: 0.84, sx: 1.1 }, "anticipate").show("flip", 70).sound("whoosh");
    const c = { x: (u) => bar - g.u * 0.7 + g.u * 1.6 * u, y: (u) => g.floor - g.u * 0.75 - g.u * 1.1 * Math.sin(Math.PI * u) };
    turnAbout(k, 760, c, g.u * 0.75, 0, -360, 14);
    k.set({ r: 0 });
    k.show("land", 60).to(90, { y: g.floor, sy: 0.8, sx: 1.14 }, "out").to(380, { sy: 1, sx: 1 }, "spring");
    k.sound("applause");
    k.prop("cup", "trophy");
    pop(k, "cup", k.t, { x: k.now.x - g.u * 0.6, y: g.floor });
    k.show("celebrate", 130);
    bounce(k, g, 2, 300, 0.08);
    gone(k, "cup", k.t + 300);
    gone(k, "bar", k.t + 200, 360);
    gone(k, "mat", k.t + 200, 360);
    k.show("standing", 130).wait(620);
  });

  add("Sports", "frisbee", "Frisbee", ["paper-plane", "celebrate", "standing"], { room: { right: 3 } }, (k, g) => {
    k.prop("disc", "frisbee");
    pose(k, "paper-plane", 130);
    const h = spot(k, g, "paper-plane", "near");
    k.propAt("disc", 0, { x: h.x, y: h.y, o: 0 }).propAt("disc", k.t, { o: 1 });
    k.to(260, { r: -6 }, "soft").to(120, { r: 8 }, "in").sound("swish");
    const t0 = k.t;
    // Out to the right in a curve, and back like a boomerang.
    const far = { x: h.x + g.u * 2.6, y: h.y - g.u * 0.9 };
    const steps = 16;
    for (let i = 1; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI;
      k.propAt("disc", t0 + 1900 * (i / steps), { x: h.x + (far.x - h.x) * Math.sin(a), y: h.y + (far.y - h.y) * Math.sin(a) * 0.9 - g.u * 0.4 * Math.sin(a * 2),
        r: -12 * Math.sin(a) }, "linear");
    }
    k.to(300, { r: 0 }, "springSoft").show("standing", 130).wait(Math.max(0, t0 + 1500 - k.t));
    R.jump(k, g, { h: g.u * 0.35, pose: "celebrate", land: "celebrate" });
    k.propAt("disc", k.t, { x: k.now.x + g.u * 0.45, y: g.floor - g.u * 1.0 });
    k.wait(300).show("standing", 130);
  });

  add("Sports", "swimming", "Swimming", ["fly", "standing"], { room: { right: 3.2 } }, (k, g) => {
    k.prop("water", "water");
    const x0 = k.now.x;
    pop(k, "water", 0, { x: x0 + g.u * 1.6, y: g.floor + g.u * 0.02, sx: 1.2 }, 500);
    k.wait(300);
    // A dive in, then strokes to the right (the fly picture, lying flat).
    k.to(130, { sy: 0.85, sx: 1.08 }, "anticipate").show("fly", 80);
    R.arc(k, 460, { x: x0 + g.u * 0.6, y: g.floor - g.u * 0.2 }, g.u * 0.35, { spin: 80 });
    k.fx("spray", 0, -g.u * 0.1).sound("whoosh", -100);
    for (let i = 0; i < 6; i += 1) {
      k.to(260, { x: k.now.x + g.u * 0.21, y: g.floor - g.u * 0.26, r: 76 }, "soft").to(260, { x: k.now.x + g.u * 0.21, y: g.floor - g.u * 0.18, r: 84 }, "soft");
      k.fx("bubbles", -g.u * 0.4, -g.u * 0.3);
    }
    // Out, and a shake.
    k.to(300, { r: 0, y: g.floor - g.u * 0.4 }, "out").show("standing", 120).to(260, { y: g.floor }, "fall").to(300, { sy: 1, sx: 1 }, "spring");
    for (let i = 0; i < 4; i += 1) k.to(70, { r: i % 2 ? -5 : 5 }, "linear");
    k.fx("drop", -g.u * 0.3, -g.u * 1).fx("drop", g.u * 0.35, -g.u * 0.9).to(200, { r: 0 }, "springSoft");
    gone(k, "water", k.t, 400);
    k.wait(300);
  });

  // ------------------------------------------------------------ Fun and Tricks

  add("Fun and Tricks", "cartwheel", "Cartwheel", ["standing", "cartwheel"], { room: { left: 2, right: 2 } }, (k, g) => {
    const dir = k.now.x - g.left > g.right - k.now.x ? -1 : 1;
    const x0 = k.now.x;
    const h = g.u * 0.72;
    k.to(140, { sy: 0.88, sx: 1.06, r: -dir * 3 }, "anticipate").sound("whoosh");
    // Round a point at his middle, travelling: the cartwheel picture (upside
    // down, as drawn) for the middle half, so it never shows the wrong way up.
    let showing = "standing";
    const c = { x: (u) => x0 + dir * g.u * 1.6 * u, y: () => g.floor - h };
    turnAbout(k, 900, c, h, 0, dir * 360, 18, (th) => {
      const a = Math.abs(th);
      const want = a > 100 && a < 260 ? "cartwheel" : "standing";
      if (want !== showing) { showing = want; k.show(want, 50); }
    });
    k.set({ r: 0 }).show("standing", 60).to(80, { sy: 0.86, sx: 1.08 }, "out").to(380, { sy: 1, sx: 1 }, "spring").fx("dust", 0, 0, { dir });
    k.fx("sparkle", 0, -g.u * 1.3);
  });

  add("Fun and Tricks", "handstand", "Handstand", ["standing", "cartwheel"], { room: { left: 0.6, right: 0.6 } }, (k, g) => {
    R.jump(k, g, { h: g.u * 0.3, pose: "cartwheel", land: "cartwheel" });
    for (let i = 0; i < 3; i += 1) k.to(320, { r: i % 2 ? -4 : 4, x: k.now.x + (i % 2 ? -1 : 1) * g.u * 0.03 }, "soft");
    k.to(260, { r: 0 }, "springSoft");
    k.fx("sparkle", g.u * 0.4, -g.u * 1.2);
    R.jump(k, g, { h: g.u * 0.35, pose: "standing", land: "standing" });
  });

  add("Fun and Tricks", "yo-yo", "Yo-Yo", ["standing"], {}, (k, g) => {
    k.prop("string", "yoyostring", "body").prop("yo", "yoyo", "body");
    const h = rel(g, "standing", "near");
    k.propAt("string", 0, { x: h.x, y: h.y, sy: 0.02, o: 1 }).propAt("yo", 0, { x: h.x, y: h.y, o: 0 }).propAt("yo", 200, { o: 1 });
    let t = 300;
    for (let i = 0; i < 3; i += 1) {
      const len = g.u * (0.3 + 0.03 * i);
      k.propAt("string", t + 420, { sy: len / g.u }, "fall").propAt("yo", t + 420, { y: h.y + len, r: 720 }, "fall");
      k.propAt("string", t + 900, { sy: 0.02 }, "rise").propAt("yo", t + 900, { y: h.y, r: 1440 }, "rise");
      t += 950;
    }
    // Around the world.
    const L = g.u * 0.36;
    for (let i = 1; i <= 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      k.propAt("string", t + 80 * i, { sy: L / g.u, r: -(i / 12) * 360 }, "linear")
        .propAt("yo", t + 80 * i, { x: h.x + L * Math.sin(a), y: h.y + L * Math.cos(a) }, "linear");
    }
    k.propAt("string", t + 1200, { sy: 0.02, r: -360 }, "rise").propAt("yo", t + 1200, { x: h.x, y: h.y }, "rise");
    for (let i = 0; i < 4; i += 1) k.to(t / 4, { r: i % 2 ? -2 : 2 }, "soft");
    k.to(1300, { r: 0 }, "soft").fx("sparkle", g.u * 0.4, -g.u * 0.8);
    gone(k, "yo", k.t).propAt("string", k.t + 260, { o: 0 });
    k.wait(280);
  });

  add("Fun and Tricks", "bubble-gum", "Bubble Gum", ["standing", "celebrate", "laugh"], {}, (k, g) => {
    k.prop("gum", "gum", "body");
    const m = rel(g, "standing", "mouth");
    k.propAt("gum", 0, { x: m.x, y: m.y, sx: 0.1, sy: 0.1, o: 0 }).propAt("gum", 200, { o: 1 });
    // Growing in puffs, wobbling.
    let t = 300;
    for (let i = 1; i <= 5; i += 1) {
      k.propAt("gum", t + 380, { sx: 0.35 * i, sy: 0.33 * i, x: m.x + g.u * 0.02 * i }, "springSoft");
      t += 450;
    }
    k.to(t, { sy: 1.03 }, "soft");
    k.propAt("gum", t + 80, { o: 0, sx: 2.2, sy: 2.1 }, "out");
    k.fxAt(t, "pop", k.now.x + m.x + g.u * 0.1, k.now.y + m.y).sound("pop", 0);
    k.show("celebrate", 50).to(100, { y: g.floor - g.u * 0.2, sy: 1.12, sx: 0.93 }, "rise").to(180, { y: g.floor, sy: 0.9, sx: 1.06 }, "fall")
      .to(300, { sy: 1, sx: 1 }, "spring");
    pose(k, "laugh", 120);
    bounce(k, g, 3, 240, 0.04);
    k.show("standing", 130);
  });

  add("Fun and Tricks", "magic-hat", "Magic Trick", ["magic", "standing"], { room: { right: 1.3 } }, (k, g, r) => {
    k.prop("hat", "tophat").prop("bunny", "bunny").prop("wand", "wand", "body");
    const hx = k.now.x + g.u * 0.85;
    pop(k, "hat", 0, { x: hx, y: g.floor });
    const h = rel(g, "standing", "near");
    pop(k, "wand", 200, { x: h.x, y: h.y, r: 30 });
    k.wait(500);
    gone(k, "wand", k.t, 150);
    pose(k, "magic", 150);
    k.sound("chime");
    shower(k, g, "sparkle", 5, 900, hx - g.u * 0.3, hx + g.u * 0.3, g.floor - g.u * 0.9, g.floor - g.u * 0.5, r);
    hold(k, 900);
    // Out pops a bunny.
    k.propAt("bunny", k.t, { x: hx, y: g.floor - g.u * 0.2, o: 0, sy: 0.3 }).propAt("bunny", k.t + 450, { y: g.floor - g.u * 0.32, o: 1, sy: 1 }, "spring");
    k.fx("star", g.u * 0.85, -g.u * 0.8).sound("applause", 900);
    k.show("standing", 130);
    bounce(k, g, 2, 300, 0.06);
    gone(k, "bunny", k.t + 300);
    gone(k, "hat", k.t + 400, 360);
    k.wait(760);
  });

  add("Fun and Tricks", "juggling", "Juggling", ["juggle", "standing"], {}, (k, g) => {
    const balls = ["b1", "b2", "b3"];
    balls.forEach((id, i) => k.prop(id, `jball${i + 1}`));
    pose(k, "juggle", 140);
    const near = spot(k, g, "juggle", "near");
    const far = spot(k, g, "juggle", "far");
    const t0 = k.t;
    // A cascade: each ball goes up from one hand to the other, the throws
    // a third of a cycle apart.
    const cyc = 900;
    balls.forEach((id, i) => {
      let t = t0 + (cyc / 3) * i;
      let from = i % 2 ? far : near;
      k.propAt(id, t0, { x: from.x, y: from.y, o: 0 }).propAt(id, t, { o: 1 });
      for (let j = 0; j < 4; j += 1) {
        const to = from === near ? far : near;
        fling(k, id, t, cyc * 0.66, from, to, g.u * 0.8, 0, 8);
        k.propAt(id, t + cyc * 0.66 + 80, { x: to.x + (to === near ? -1 : 1) * -g.u * 0.05, y: to.y + g.u * 0.03 }, "soft");
        t += cyc * 0.75;
        from = to;
      }
      k.propAt(id, t, { o: 0 });
    });
    for (let i = 0; i < 6; i += 1) k.to(cyc * 3.4 / 6, { r: i % 2 ? -2 : 2, sy: i % 2 ? 1 : 0.98 }, "soft");
    k.to(200, { r: 0, sy: 1 }, "springSoft").fx("sparkle", 0, -g.u * 1.5);
    k.show("standing", 130).wait(300);
  });

  add("Fun and Tricks", "paper-plane", "Paper Plane", ["paper-plane", "standing", "wave"], { room: { right: 3 } }, (k, g) => {
    k.prop("plane", "plane");
    pose(k, "paper-plane", 130);
    const h = spot(k, g, "paper-plane", "near");
    k.propAt("plane", 0, { x: h.x, y: h.y, o: 0 }).propAt("plane", k.t, { o: 1, r: -10 });
    k.to(240, { r: -5 }, "soft").to(110, { r: 6 }, "in").sound("whoosh");
    const t0 = k.t;
    // Out, a loop-the-loop, and a glide down.
    const pts = [];
    const loop = { x: h.x + g.u * 1.6, y: h.y - g.u * 0.9 };
    pts.push([h.x + g.u * 0.8, h.y - g.u * 0.5, -25]);
    for (let i = 0; i <= 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      pts.push([loop.x + g.u * 0.45 * Math.sin(a), loop.y + g.u * 0.45 * (1 - Math.cos(a)) - g.u * 0.45, -25 - (i / 12) * 360]);
    }
    pts.push([loop.x + g.u * 0.9, h.y - g.u * 0.3, -385], [loop.x + g.u * 1.5, g.floor - g.u * 0.05, -360]);
    pts.forEach((q, i) => k.propAt("plane", t0 + 140 * (i + 1), { x: q[0], y: q[1], r: q[2] }, "linear"));
    k.propAt("plane", t0 + 140 * (pts.length + 2), { o: 0 });
    k.show("wave", 120);
    k.to(400, { r: 0 }, "springSoft");
    sway(k, 2, 4, 500);
    k.wait(Math.max(0, t0 + 140 * (pts.length + 2) - k.t)).show("standing", 130).wait(200);
  });

  add("Fun and Tricks", "kite", "Kite Surfing", ["kite", "standing"], { room: { right: 3.4 } }, (k, g) => {
    pose(k, "kite", 150);
    k.heading(1).sound("whoosh");
    const x0 = k.now.x;
    for (let i = 1; i <= 9; i += 1) {
      const u = i / 9;
      k.to(300, { x: x0 + g.u * 3 * u, y: g.floor - g.u * 0.06 * Math.abs(Math.sin(u * Math.PI * 4)), r: 3 * Math.sin(u * Math.PI * 3) }, "soft");
      if (i % 3 === 0) k.fx("swoosh", -g.u * 0.6, -g.u * 0.4);
    }
    k.heading(0).to(300, { r: 0 }, "springSoft");
    k.show("standing", 140).wait(200);
  });

  add("Fun and Tricks", "balloon", "Balloon Float", ["standing", "wave", "land"], {}, (k, g) => {
    k.prop("balloon", "balloon", "body");
    const h = rel(g, "wave", "up");
    pose(k, "wave", 130);
    pop(k, "balloon", k.t - 200, { x: h.x, y: h.y + g.u * 0.1 });
    k.wait(300);
    // Up he goes, drifting.
    const top = Math.max(g.top, g.floor - g.u * 1.5);
    for (let i = 1; i <= 6; i += 1) {
      k.to(380, { y: g.floor - (g.floor - top) * (i / 6), x: k.now.x + (i % 2 ? 1 : -1) * g.u * 0.12, r: i % 2 ? 4 : -4 }, "soft");
    }
    k.to(300, { r: 0 }, "soft");
    k.propAt("balloon", k.t, {}).propAt("balloon", k.t + 60, { o: 0, sx: 1.4, sy: 1.4 }, "out");
    k.fx("pop", h.x - g.u * 0.0, h.y - g.u * 0.7).sound("pop");
    k.wait(120).fx("bang", 0, -g.u * 1.5);
    R.touchDown(k, g, k.now.x);
  });

  add("Fun and Tricks", "trampoline", "Trampoline", ["trampoline", "celebrate", "flip", "standing"], {}, (k, g) => {
    k.prop("tramp", "trampoline");
    const x0 = k.now.x;
    const bed = g.floor - g.u * 0.28;
    // Little bounces on the trampoline in his picture, then the big ones on a drawn one.
    pose(k, "trampoline", 160);
    for (let i = 0; i < 2; i += 1) k.to(120, { sy: 0.93, sx: 1.04 }, "out").to(240, { sy: 1, sx: 1 }, "spring").sound("boing", -300);
    pop(k, "tramp", k.t - 300, { x: x0, y: g.floor, sx: 0.85, sy: 1.4 }, 300);
    k.show("standing", 60).set({ y: bed });
    for (let i = 0; i < 3; i += 1) {
      const hgt = g.u * (0.7 + 0.35 * i);
      k.to(110, { sy: 0.84, sx: 1.1 }, "out").sound("boing");
      k.propAt("tramp", k.t - 110, {}).propAt("tramp", k.t, { sy: 1.15 }, "out").propAt("tramp", k.t + 300, { sy: 1.4 }, "spring");
      if (i === 2) {
        k.show("flip", 60);
        turnAbout(k, 800, { x: x0, y: (u) => bed - g.u * 0.75 - hgt * Math.sin(Math.PI * u) }, g.u * 0.75, 0, 360, 16);
        k.set({ r: 0 }).show("celebrate", 60);
      } else {
        k.show("celebrate", 60);
        R.arc(k, 500 + 120 * i, { x: x0, y: bed }, hgt);
      }
      k.show("standing", 60);
    }
    k.to(80, { sy: 0.84, sx: 1.1 }, "out").to(300, { sy: 1, sx: 1 }, "spring");
    R.jump(k, g, { h: g.u * 0.25, y: g.floor, x: x0 + g.u * 0.6, land: "standing" });
    gone(k, "tramp", k.t, 360);
    k.wait(300);
  });

  add("Fun and Tricks", "pogo", "Pogo Stick", ["standing", "celebrate"], { room: { left: 2, right: 2 } }, (k, g) => {
    k.prop("pogo", "pogo", "body");
    const dir = k.now.x - g.left > g.right - k.now.x ? -1 : 1;
    const lift = g.u * 0.25;
    pop(k, "pogo", 0, { x: 0, y: 0 });
    R.jump(k, g, { h: g.u * 0.3, y: g.floor - lift, dust: false });
    for (let i = 0; i < 6; i += 1) {
      k.to(90, { sy: 0.88, sx: 1.05 }, "out").sound("boing", 0);
      R.arc(k, 380, { x: k.now.x + dir * g.u * 0.35, y: g.floor - lift }, g.u * 0.35, { r: dir * 4 });
    }
    k.to(90, { sy: 0.88 }, "out").to(260, { sy: 1, sx: 1, r: 0 }, "spring");
    gone(k, "pogo", k.t + 250, 200);
    R.jump(k, g, { h: g.u * 0.25, y: g.floor, x: k.now.x + dir * g.u * 0.25, pose: "celebrate", land: "standing" });
  });

  add("Fun and Tricks", "head-spin", "Head Spin", ["spin", "standing"], {}, (k, g) => {
    k.to(140, { sy: 0.86, sx: 1.08 }, "anticipate").show("spin", 90).sound("whoosh");
    for (let i = 0; i < 10; i += 1) {
      k.to(90, { sx: i % 2 ? 1 : 0.84, r: i % 2 ? 2 : -2 }, "soft");
      if (i % 3 === 0) k.fx("swoosh", 0, -g.u * 0.3);
    }
    k.to(140, { sx: 1, r: 0 }, "out");
    R.jump(k, g, { h: g.u * 0.4, pose: "standing", land: "standing" });
    k.fx("sparkle", g.u * 0.4, -g.u * 1.3);
  });

  add("Fun and Tricks", "rainbow", "Rainbow Flight", ["fly", "land", "standing"], {}, (k, g, r) => {
    const to = R.floorSpot({ ...g, pos: k.now }, 0.3, 0.8);
    k.to(150, { sy: 0.84, sx: 1.1 }, "anticipate").show("fly", 90).sound("chime");
    k.to(220, { y: g.floor - g.u * 0.4, sy: 1.12, sx: 0.92 }, "rise");
    const a = k.now;
    const b = { x: to, y: g.floor - g.u * 0.9 };
    const peak = Math.max(g.top, g.floor - g.u * 2.6);
    const dir = Math.sign(b.x - a.x) || 1;
    R.path(k, 1800, (u) => ({ x: a.x + (b.x - a.x) * u, y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * peak + u * u * b.y }), 20, (u) => {
      k.fx("rainbow", -dir * g.u * 0.2, -g.u * 0.45);
      return { r: dir * 6 * Math.sin(u * Math.PI), sy: 1, sx: 1 };
    });
    k.to(200, { r: 0 }, "springSoft");
    R.touchDown(k, g, to);
  });

  add("Fun and Tricks", "teleport", "Teleport", ["teleport", "standing"], {}, (k, g) => {
    pose(k, "teleport", 160);
    k.sound("whoosh");
    k.fx("sparkle", -g.u * 0.3, -g.u * 0.9).fx("sparkle", g.u * 0.35, -g.u * 0.5);
    k.to(320, { sx: 1.1, sy: 1.1 }, "soft").to(260, { sx: 0.04, sy: 0.04 }, "in").fx("flash", 0, -g.u * 0.5);
    const to = R.floorSpot({ ...g, pos: k.now }, 0.12, 0.35);
    k.wait(200).set({ x: to }).fx("flash", 0, -g.u * 0.5).fx("sparkle", 0, -g.u * 0.8);
    k.to(420, { sx: 1, sy: 1 }, "spring").wait(300);
    k.show("standing", 140).fx("sparkle", g.u * 0.4, -g.u * 1.3).wait(200);
  });

  add("Fun and Tricks", "shrink-grow", "Shrink and Grow", ["standing", "laugh"], {}, (k, g) => {
    k.to(400, { sx: 0.4, sy: 0.4 }, "spring").sound("boing");
    for (let i = 0; i < 3; i += 1) k.to(130, { y: g.floor - g.u * 0.12, sy: 0.43 }, "rise").to(130, { y: g.floor, sy: 0.37 }, "fall");
    k.to(150, { sy: 0.4 }, "soft").wait(200);
    k.to(500, { sx: 1.35, sy: 1.35 }, "spring").fx("dust", g.u * 0.3, 0, { dir: 1 }).fx("dust", -g.u * 0.3, 0, { dir: -1 });
    k.wait(300).to(420, { sx: 1, sy: 1 }, "springSoft");
    pose(k, "laugh", 120);
    bounce(k, g, 2, 260, 0.04);
    k.show("standing", 130);
  });

  // ------------------------------------------------------------ Moods

  add("Moods", "yawn-stretch", "Yawn and Stretch", ["yawn", "celebrate", "standing"], {}, (k, g) => {
    pose(k, "yawn", 160);
    k.sound("yawn");
    k.to(900, { sy: 1.04, sx: 0.98, r: -3 }, "soft").to(500, { sy: 1, sx: 1, r: 0 }, "soft");
    k.show("celebrate", 160).to(800, { sy: 1.09, sx: 0.96 }, "soft").wait(300).to(300, { sy: 0.92, sx: 1.05 }, "in");
    k.show("standing", 140).to(400, { sy: 1, sx: 1 }, "spring");
  });

  add("Moods", "sleepy", "Sleepy Nod-Off", ["lounge", "standing"], {}, (k, g) => {
    pose(k, "lounge", 180);
    for (let i = 0; i < 3; i += 1) {
      k.to(700, { r: 5 + i * 2, sy: 0.98 }, "soft").fx("zzz", g.u * 0.3, -g.u * 1.1).to(260, { r: 1 }, "out");
    }
    k.to(900, { r: 8 }, "soft").fx("zzz", g.u * 0.3, -g.u * 1.1).fx("zzz", g.u * 0.45, -g.u * 1.3).wait(500);
    // Awake with a start.
    k.to(90, { r: -3, sy: 1.04 }, "out").fx("bang", 0, -g.u * 1.4).to(300, { r: 0, sy: 1 }, "spring");
    k.show("standing", 150).to(260, { sy: 1 }, "soft");
  });

  add("Moods", "sneeze", "Sneeze", ["sneeze", "standing"], {}, (k, g) => {
    pose(k, "sneeze", 150);
    say(k, g, "Ah…");
    k.to(500, { r: -5, sy: 1.04 }, "soft").to(200, { r: -2 }, "soft").to(600, { r: -9, sy: 1.07 }, "soft");
    k.to(90, { r: 10, sy: 0.9, sx: 1.06, x: k.now.x - g.u * 0.05 }, "out").sound("sneeze", -60);
    const n = spot(k, g, "sneeze", "nose");
    k.fxAt(k.t, "spray", n.x, n.y).fxAt(k.t + 80, "spray", n.x + g.u * 0.1, n.y + g.u * 0.05);
    k.to(140, { x: k.now.x - g.u * 0.08 }, "out").to(400, { r: 0, sy: 1, sx: 1 }, "spring");
    k.wait(300).show("standing", 140).wait(200);
  });

  add("Moods", "laugh", "Big Laugh", ["laugh", "standing"], {}, (k, g) => {
    pose(k, "laugh", 140);
    say(k, g, "Ha ha!");
    for (let i = 0; i < 7; i += 1) k.to(110, { sy: i % 2 ? 1.03 : 0.95, sx: i % 2 ? 0.99 : 1.03, r: i % 2 ? -2 : 3 }, "soft");
    k.to(200, { r: 6 }, "soft").to(300, { r: 0, sy: 1, sx: 1 }, "spring");
    bounce(k, g, 2, 220, 0.04);
    k.show("standing", 140);
  });

  add("Moods", "surprised", "Surprised", ["standing", "celebrate", "shy"], {}, (k, g) => {
    k.fx("bang", 0, -g.u * 1.5);
    k.to(70, { sy: 0.9, sx: 1.05 }, "out").show("celebrate", 50);
    R.arc(k, 380, { x: k.now.x, y: g.floor }, g.u * 0.4, { stretch: 1.6 });
    k.to(80, { sy: 0.82, sx: 1.12 }, "out").to(360, { sy: 1, sx: 1 }, "spring");
    pose(k, "shy", 140);
    hold(k, 700);
    k.show("standing", 140);
  });

  add("Moods", "shy", "Shy", ["shy", "standing"], {}, (k, g) => {
    // To the nearer screen edge, then half out of sight behind it.
    const side = k.now.x - g.left < g.right - k.now.x ? -1 : 1;
    const edge = side < 0 ? g.left : g.right;
    if (Math.abs(edge - k.now.x) > 2) R.steps(k, g, edge, false);
    pose(k, "shy", 150);
    k.fx("blush", 0, -g.u * 0.92);
    const hide = edge + side * g.u * 0.75;
    k.to(500, { x: hide }, "soft").wait(500);
    for (let i = 0; i < 2; i += 1) k.to(300, { x: edge + side * g.u * 0.35, r: -side * 6 }, "out").wait(400).to(300, { x: hide, r: 0 }, "in").wait(300);
    k.fx("blush", -side * g.u * 0.6, -g.u * 0.92);
    k.to(500, { x: edge }, "springSoft");
    k.show("standing", 140).wait(200);
  });

  add("Moods", "thinking", "Bright Idea", ["arms-crossed", "point", "standing"], {}, (k, g) => {
    k.prop("bulb", "bulb", "body");
    pose(k, "arms-crossed", 150);
    say(k, g, "Hmm…");
    k.to(700, { r: -4 }, "soft").wait(300).to(700, { r: 4 }, "soft").wait(300);
    // The idea: a bulb pops on above his head.
    pop(k, "bulb", k.t, { x: 0, y: -g.u * 1.7 });
    k.sound("chime");
    k.fx("sparkle", 0, -g.u * 1.85);
    pose(k, "point", 100, 300);
    k.to(100, { r: 0 }, "out");
    bounce(k, g, 1, 300, 0.1);
    hold(k, 400);
    gone(k, "bulb", k.t);
    k.show("standing", 140).wait(260);
  });

  add("Moods", "confused", "Confused", ["shy", "arms-crossed", "standing"], { room: { right: 1.1 } }, (k, g) => {
    k.prop("globe", "globe");
    pop(k, "globe", 0, { x: k.now.x + g.u * 0.8, y: g.floor });
    k.wait(300);
    pose(k, "arms-crossed", 150);
    for (let i = 0; i < 3; i += 1) {
      k.to(420, { r: i % 2 ? 8 : -8 }, "soft").fx("qmark", (i % 2 ? 1 : -1) * g.u * 0.35, -g.u * 1.5).wait(200);
    }
    k.to(300, { r: 0 }, "springSoft");
    pose(k, "shy", 150);
    hold(k, 700);
    gone(k, "globe", k.t, 360);
    k.show("standing", 140).wait(300);
  });

  add("Moods", "proud", "Proud", ["arms-crossed", "standing"], {}, (k, g) => {
    k.prop("crown", "crown", "body");
    pose(k, "arms-crossed", 150);
    k.to(500, { sx: 1.1, sy: 1.05 }, "spring");
    k.propAt("crown", k.t, { x: 0, y: -g.u * 2.6, o: 0, r: -10 }).propAt("crown", k.t + 200, { o: 1 })
      .propAt("crown", k.t + 700, { y: -g.u * 1.46, r: 0 }, "spring");
    k.wait(650).to(90, { sy: 0.98 }, "out").to(300, { sy: 1.05 }, "spring");
    k.sound("applause");
    k.fx("sparkle", -g.u * 0.25, -g.u * 1.6).fx("star", g.u * 0.3, -g.u * 1.4);
    hold(k, 1000);
    k.to(400, { sx: 1, sy: 1 }, "springSoft");
    k.propAt("crown", k.t, {}).propAt("crown", k.t + 400, { y: -g.u * 2.2, o: 0 }, "in");
    k.wait(300).show("standing", 140).wait(200);
  });

  add("Moods", "cheering", "Cheering", ["confetti", "celebrate", "standing"], {}, (k, g) => {
    k.sound("applause");
    pose(k, "confetti", 140);
    k.fx("confetti", 0, -g.u * 1.4);
    bounce(k, g, 2, 300, 0.07);
    R.jump(k, g, { h: g.u * 0.4, pose: "celebrate", land: "celebrate" });
    k.fx("confetti", -g.u * 0.5, -g.u * 1.2).fx("confetti", g.u * 0.5, -g.u * 1.3);
    R.jump(k, g, { h: g.u * 0.3, pose: "celebrate", land: "confetti" });
    k.wait(500).show("standing", 140).wait(200);
  });

  add("Moods", "sad-happy", "Sad, Then Happy", ["sitting", "celebrate", "standing"], {}, (k, g, r) => {
    k.prop("cloud", "cloud").prop("sun", "sun");
    pose(k, "sitting", 180);
    const cx = k.now.x;
    const cy = k.now.y - g.u * 1.45;
    pop(k, "cloud", k.t, { x: cx, y: cy });
    k.to(800, { r: 6, sy: 0.96 }, "soft");
    shower(k, g, "rain", 10, 1600, cx - g.u * 0.35, cx + g.u * 0.35, cy + g.u * 0.1, cy + g.u * 0.15, r);
    k.wait(1600);
    // The sun pushes the cloud away.
    k.propAt("sun", k.t, { x: cx - g.u * 1.4, y: cy - g.u * 0.2, o: 0 }).propAt("sun", k.t + 600, { x: cx - g.u * 0.4, o: 1, r: 60 }, "out");
    k.propAt("cloud", k.t + 300, {}).propAt("cloud", k.t + 900, { x: cx + g.u * 1.2, o: 0 }, "in");
    k.to(600, { r: 0, sy: 1 }, "soft");
    k.show("standing", 150).to(200, { sy: 1 }, "soft");
    R.jump(k, g, { h: g.u * 0.4, pose: "celebrate", land: "celebrate" });
    k.fx("heart", -g.u * 0.4, -g.u * 1.3).fx("heart", g.u * 0.4, -g.u * 1.4);
    gone(k, "sun", k.t + 200, 400);
    k.wait(600).show("standing", 140).wait(100);
  });

  add("Moods", "hiccups", "Hiccups", ["standing", "shy"], {}, (k, g) => {
    for (const gap of [500, 900, 400, 1100]) {
      k.wait(gap);
      k.to(60, { y: g.floor - g.u * 0.12, sy: 1.12, sx: 0.94 }, "out").to(180, { y: g.floor, sy: 0.95, sx: 1.03 }, "fall").to(200, { sy: 1, sx: 1 }, "springSoft");
      k.fx("bubbles", g.u * 0.15, -g.u * 1.0).fx("bubble", 0, -g.u * 1.72, { text: "hic!" });
    }
    pose(k, "shy", 150);
    say(k, g, "Phew.");
    hold(k, 800);
    k.show("standing", 140);
  });

  add("Moods", "shiver", "Shiver", ["shiver", "standing"], {}, (k, g, r) => {
    pose(k, "shiver", 150);
    const x0 = k.now.x;
    for (let i = 0; i < 22; i += 1) {
      k.to(50, { x: x0 + (i % 2 ? -1 : 1) * g.u * 0.025, sy: i % 4 < 2 ? 0.99 : 1 }, "linear");
      if (i % 5 === 0) k.fx("ice", (r() - 0.5) * g.u * 1.2, -g.u * (0.6 + r() * 0.8));
    }
    k.to(200, { x: x0 }, "soft");
    say(k, g, "Brrr!");
    sway(k, 2, 4, 400);
    k.show("standing", 140).wait(200);
  });

  add("Moods", "hot-day", "Hot Day", ["standing", "wave"], {}, (k, g) => {
    k.prop("sun", "sun");
    const sx = clamp(k.now.x + g.u * 1.2, g.left, g.right);
    k.propAt("sun", 0, { x: sx, y: Math.max(g.u * 0.4, g.floor - g.u * 2.6), o: 0, sx: 0.8, sy: 0.8 }).propAt("sun", 500, { o: 1, sx: 1, sy: 1 }, "spring")
      .propAt("sun", 3800, { r: 120 }, "linear");
    k.wait(300).fx("heat", g.u * 0.3, -g.u * 1.2).fx("drop", -g.u * 0.25, -g.u * 1.1);
    k.to(600, { sy: 0.96, r: 3 }, "soft").fx("drop", g.u * 0.28, -g.u * 1.05).wait(300);
    pose(k, "wave", 140);
    for (let i = 0; i < 2; i += 1) k.to(260, { r: -6 }, "soft").to(260, { r: 4 }, "soft");
    k.to(300, { r: 0, sy: 1 }, "springSoft");
    say(k, g, "Phew!");
    k.show("standing", 140).wait(500);
    gone(k, "sun", Math.max(k.t, 3800), 400);
    k.wait(Math.max(0, 4250 - k.t));
  });

  add("Moods", "heart-eyes", "Heart Eyes", ["heart-eyes", "love", "standing"], {}, (k, g, r) => {
    pose(k, "heart-eyes", 160);
    for (let i = 0; i < 4; i += 1) {
      k.to(300, { y: g.floor - g.u * 0.05, sy: 1.03 }, "rise").to(300, { y: g.floor, sy: 0.97 }, "fall");
      k.fx("heart", (r() - 0.5) * g.u * 1.1, -g.u * (1.1 + 0.4 * r()));
    }
    k.to(200, { sy: 1 }, "springSoft");
    pose(k, "love", 150);
    hold(k, 800);
    k.show("standing", 150);
  });

  // ------------------------------------------------------------ Screen

  add("Screen", "peek-door", "Peek Around the Door", ["standing", "peek-door", "wave"], { room: { left: 0.6, right: 1.2 } }, (k, g) => {
    k.prop("door", "door");
    const x0 = k.now.x;
    const dx = x0 + g.u * 0.53;
    pop(k, "door", 0, { x: dx, y: g.floor });
    k.wait(450);
    // Behind it (the door is in front of him)…
    k.to(400, { x: dx, sy: 0.98 }, "soft").wait(400);
    // …and peeking out from its edge, twice.
    for (let i = 0; i < 2; i += 1) {
      k.show("peek-door", 90).to(320, { x: x0 + g.u * 0.02 }, "out").wait(600).to(320, { x: dx }, "in").show("standing", 90).wait(400);
    }
    k.show("peek-door", 90).to(320, { x: x0 }, "out").wait(300).show("wave", 120);
    sway(k, 1, 6, 500);
    k.show("standing", 130);
    gone(k, "door", k.t, 360);
    k.to(400, { x: x0 - g.u * 0.1 }, "soft");
  });

  add("Screen", "knock", "Knock on the Glass", ["knock", "standing"], {}, (k, g) => {
    pose(k, "knock", 150);
    closer(k, 1.22);
    const s = 1.22;
    const kn = { x: k.now.x + H.knock.knuckle[0] * g.u * s, y: k.now.y + H.knock.knuckle[1] * g.u * s };
    say(k, g, "Knock knock!", 1.72 * s);
    for (let i = 0; i < 3; i += 1) {
      k.to(90, { r: -3 }, "out").to(70, { r: 2 }, "in").fxAt(k.t, "ripple", kn.x, kn.y).sound("knock", 0).wait(220);
    }
    k.to(200, { r: 0 }, "springSoft").wait(500);
    back(k);
    k.show("standing", 140).wait(200);
  });

  add("Screen", "wipe", "Wipe the Screen", ["wave", "standing"], {}, (k, g) => {
    k.prop("cloth", "cloth", "body");
    pose(k, "wave", 140);
    closer(k, 1.25);
    const h = rel(g, "wave", "up");
    pop(k, "cloth", k.t - 300, { x: h.x, y: h.y });
    k.sound("chime");
    // Round and round on the glass.
    for (let i = 0; i < 2; i += 1) {
      const t0 = k.t;
      for (let j = 1; j <= 8; j += 1) {
        const a = (j / 8) * Math.PI * 2;
        k.propAt("cloth", t0 + j * 90, { x: h.x + g.u * 0.22 * Math.sin(a), y: h.y + g.u * 0.18 * (1 - Math.cos(a)), r: 15 * Math.sin(a) }, "linear");
      }
      k.to(360, { r: 4 }, "soft").to(360, { r: -4 }, "soft");
      k.fxAt(t0 + 300, "streak", k.now.x + h.x * 1.25, k.now.y + h.y * 1.25 + g.u * 0.2);
    }
    k.fx("sparkle", h.x * 1.25, h.y * 1.25).fx("star", h.x * 1.25 + g.u * 0.4, h.y * 1.25 + g.u * 0.2);
    k.to(200, { r: 0 }, "springSoft");
    gone(k, "cloth", k.t);
    back(k);
    k.show("standing", 140).wait(100);
  });

  add("Screen", "draw-smiley", "Draw a Smiley", ["point-screen", "draw-smiley", "standing"], { room: { left: 1.3 } }, (k, g) => {
    k.prop("ring", "smiley-ring").prop("eyes", "smiley-eyes").prop("mouth", "smiley-mouth");
    pose(k, "point-screen", 150);
    closer(k, 1.15);
    // Drawing on the glass beside him: the face, the eyes, the smile.
    const c = { x: k.now.x - g.u * 0.95, y: g.floor - g.u * 1.0 };
    const t0 = k.t;
    k.propAt("ring", t0, { x: c.x, y: c.y, o: 0, sx: 0.2, sy: 0.2, r: -90 }).propAt("ring", t0 + 700, { o: 1, sx: 1, sy: 1, r: 0 }, "out");
    k.propAt("eyes", t0 + 600, { x: c.x, y: c.y, o: 0 }).propAt("eyes", t0 + 900, { o: 1 }, "out");
    k.propAt("mouth", t0 + 900, { x: c.x, y: c.y, o: 0, sx: 0.3 }).propAt("mouth", t0 + 1300, { o: 1, sx: 1 }, "out");
    for (let i = 0; i < 3; i += 1) k.to(220, { r: -3 }, "soft").to(220, { r: 2 }, "soft");
    k.to(150, { r: 0 }, "soft");
    k.show("draw-smiley", 140).sound("chime");
    k.fxAt(k.t, "sparkle", c.x, c.y - g.u * 0.4);
    hold(k, 900);
    back(k);
    for (const id of ["ring", "eyes", "mouth"]) gone(k, id, k.t, 400);
    k.show("standing", 140).wait(300);
  });

  add("Screen", "slide-edge", "Slide Down the Edge", ["climb1", "land", "standing"], {}, (k, g) => {
    const side = k.now.x - g.left < g.right - k.now.x ? -1 : 1;
    R.climbUp(k, g, side, Math.min(g.u * 2.2, (g.floor - g.top) * 0.7));
    // Down fast, sparks from the friction.
    const y0 = k.now.y;
    k.show(R.climbPose(side, 0), 80).to(120, { sy: 0.95 }, "out").sound("whoosh");
    for (let i = 1; i <= 6; i += 1) {
      const u = i / 6;
      k.to(90, { y: y0 + (g.floor - y0) * u * u, r: side * 2 }, "linear");
      if (i % 2) k.fx("spark", side * g.u * 0.2, -g.u * 0.9);
    }
    k.show("land", 60).to(80, { sy: 0.8, sx: 1.14, r: 0 }, "out").fx("dust", 0, 0, { dir: -side }).to(380, { sy: 1, sx: 1 }, "spring");
    k.wait(250).show("standing", 140).to(300, { x: k.now.x - side * g.u * 0.3 }, "soft");
  });

  add("Screen", "dock-sit", "Sit on the Dock", ["sitting", "laptop", "standing"], {}, (k, g) => {
    // The floor of his window is the top edge of the Dock (his window never
    // covers the Dock), so sitting on the floor is sitting on the Dock's edge.
    pose(k, "sitting", 180);
    for (let i = 0; i < 4; i += 1) k.to(320, { r: i % 2 ? -3 : 3 }, "soft");
    k.to(200, { r: 0 }, "soft");
    pose(k, "laptop", 180);
    for (let i = 0; i < 4; i += 1) k.to(260, { sy: i % 2 ? 1 : 0.985 }, "soft");
    k.fx("sparkle", g.u * 0.55, -g.u * 0.7);
    hold(k, 600);
    pose(k, "sitting", 160);
    k.show("standing", 150).to(120, { sy: 1.04 }, "out").to(260, { sy: 1 }, "springSoft");
  });

  add("Screen", "hang-top", "Hang from the Top", ["fly", "hang", "land", "standing"], {}, (k, g) => {
    // Up to the top edge (the bar in his picture right under the menu bar,
    // never over it), a swing or two, and a drop.
    const bar = g.u * 0.06;
    const L = g.u * 1.35;
    const feetY = bar + L;
    R.flyTo(k, g, { x: k.now.x, y: feetY }, true);
    k.show("hang", 120).to(260, { y: feetY, sy: 1.03 }, "springSoft");
    const px = k.now.x;
    for (let i = 1; i <= 16; i += 1) {
      const th = 9 * Math.sin((i / 16) * Math.PI * 3) * (1 - i / 22);
      const rad = (th * Math.PI) / 180;
      k.to(110, { x: px - L * Math.sin(rad), y: bar + L * Math.cos(rad), r: th }, "linear");
    }
    k.to(200, { x: px, y: feetY, r: 0 }, "soft").wait(300);
    k.show("standing", 100);
    R.touchDown(k, g, px);
  });

  add("Screen", "tightrope", "Tightrope", ["fly", "walk1", "walk2", "standing"], { room: { right: 3 } }, (k, g) => {
    k.prop("rope", "rope").prop("pole", "pole", "body");
    const x0 = k.now.x;
    const y = g.top;
    const len = g.u * 3.6;
    k.propAt("rope", 0, { x: x0 - g.u * 0.5, y, o: 0, sx: 0.1 }).propAt("rope", 500, { o: 1, sx: len / g.u }, "out");
    R.flyTo(k, g, { x: x0, y }, true);
    k.to(260, { y, sy: 1 }, "springSoft").show("standing", 120);
    pop(k, "pole", k.t, { x: 0, y: -g.u * 0.55 });
    k.wait(300);
    // Careful steps to the right, wobbling.
    k.heading(1);
    // (1.5.1: a step at each change of picture, the planted foot still on the
    // rope while a picture shows, wobbling from the ankle.)
    for (let i = 0; i < 8; i += 1) {
      k.show(i % 2 ? "walk2" : "walk1", 0).set({ x: k.now.x + g.u * 0.3 });
      const wob = (i % 3 === 1 ? 4 : 2) * (i % 2 ? -1 : 1);
      k.to(190, { r: wob }, "soft").to(190, { r: 0 }, "soft");
    }
    k.heading(0).show("standing", 120).to(400, { r: 0 }, "spring");
    gone(k, "pole", k.t);
    k.fx("sparkle", 0, -g.u * 1.3);
    k.propAt("rope", k.t + 300, {}).propAt("rope", k.t + 700, { o: 0 }, "in");
    R.touchDown(k, g, k.now.x);
  });

  add("Screen", "climb-wave", "Climb and Wave", ["climb1", "fly", "standing", "land"], {}, (k, g) => {
    const side = k.now.x - g.left < g.right - k.now.x ? -1 : 1;
    R.toWall(k, g, side);
    R.climbUp(k, g, side, Math.min(Math.max(g.u * 1.2, g.floor - g.top - g.u * 0.1), R.climbRoom(k, g, 1, 6000)));
    // (1.5.1: he waves from the air, flying, not with the standing wave
    // picture hanging off the wall.) A push off the wall into a hover, a
    // wave with a bob in the air, then down to a landing.
    const x0 = k.now.x;
    const y0 = k.now.y;
    const hx = clamp(x0 - side * g.u * 0.9, g.left, g.right);
    k.heading(0).to(140, { x: x0 + side * g.u * 0.015, sy: 0.95, sx: 1.02, r: 0 }, "anticipate");
    k.show(k.has("fly") ? "fly" : R.airPose(k), 80).to(320, { x: hx, y: y0 + g.u * 0.1, r: -side * 3, sy: 1.04, sx: 0.98 }, "out").fx("trail", 0, -g.u * 0.1);
    k.to(200, { r: 0, sy: 1, sx: 1 }, "springSoft");
    say(k, g, "Hi!");
    k.fx("bubble", g.u * 0.6, -g.u * 1.2, { text: "👋" });
    for (let i = 0; i < 3; i += 1) k.to(300, { y: y0 + g.u * 0.04, r: 2.5 }, "soft").to(300, { y: y0 + g.u * 0.12, r: -2 }, "soft");
    k.to(200, { r: 0 }, "springSoft");
    R.touchDown(k, g, hx);
  });

  add("Screen", "hide-seek", "Hide-and-Seek", ["love", "standing", "peek-door"], { room: { right: 1.8 } }, (k, g) => {
    k.prop("city", "crystal-city");
    pose(k, "love", 150);
    for (const n of ["1…", "2…", "3…"]) { k.fx("bubble", 0, -g.u * 1.6, { text: n }); k.to(350, { sy: 0.98 }, "soft").to(350, { sy: 1 }, "soft"); }
    const cx = k.now.x + g.u * 1.3;
    pop(k, "city", k.t, { x: cx, y: g.floor });
    k.show("standing", 130);
    R.steps(k, g, cx, false);
    k.wait(700);
    // Peeking out from behind it.
    for (let i = 0; i < 2; i += 1) {
      k.show("peek-door", 90).to(300, { x: cx - g.u * 0.38 }, "out").wait(450).to(300, { x: cx }, "in").show("standing", 90).wait(450);
    }
    k.to(400, { x: cx - g.u * 0.75 }, "springSoft");
    say(k, g, "Found me!");
    bounce(k, g, 2, 280, 0.07);
    gone(k, "city", k.t, 360);
    k.wait(300);
  });

  add("Screen", "butterfly", "Chase a Butterfly", ["walk1", "walk2", "celebrate", "standing"], { room: { right: 3.4 } }, (k, g) => {
    k.prop("fly", "butterfly");
    const x0 = k.now.x;
    const t0 = k.t;
    // It flutters ahead on a wavy path, its wings beating.
    const n = 28;
    for (let i = 0; i <= n; i += 1) {
      const u = i / n;
      k.propAt("fly", t0 + 160 * i, { x: x0 + g.u * (0.6 + 2.8 * u), y: g.floor - g.u * (1.2 + 0.3 * Math.sin(u * Math.PI * 5) + (u > 0.8 ? (u - 0.8) * 10 : 0)),
        o: i < n ? 1 : 0, sx: i % 2 ? 0.35 : 1 }, "linear");
    }
    R.steps(k, g, x0 + g.u * 1.2, false);
    R.jump(k, g, { h: g.u * 0.4, pose: "celebrate", land: "standing" });
    R.steps(k, g, x0 + g.u * 2.4, false);
    R.jump(k, g, { h: g.u * 0.5, pose: "celebrate", land: "standing" });
    k.wait(Math.max(0, t0 + 160 * n - k.t));
    k.fx("heart", 0, -g.u * 1.4);
  });

  add("Screen", "falling-star", "Catch a Falling Star", ["walk1", "walk2", "celebrate", "standing"], { room: { left: 1.4, right: 1.4 } }, (k, g) => {
    k.prop("star", "star");
    const x0 = k.now.x;
    const catchX = clamp(x0 + g.u * 1.2, g.left, g.right);
    const top = { x: catchX - g.u * 1.5, y: g.u * 0.2 };
    const hands = { x: catchX + g.u * 0.05, y: g.floor - g.u * 1.25 };
    const t0 = k.t;
    k.propAt("star", t0, { x: top.x, y: top.y, o: 0 }).propAt("star", t0 + 200, { o: 1 });
    for (let i = 1; i <= 12; i += 1) {
      const u = i / 12;
      k.propAt("star", t0 + 200 + 1800 * u, { x: top.x + (hands.x - top.x) * u, y: top.y + (hands.y - top.y) * u * u, r: 360 * u }, "linear");
      if (i % 2 === 0) k.fxAt(t0 + 200 + 1800 * u, "sparkle", top.x + (hands.x - top.x) * u, top.y + (hands.y - top.y) * u * u);
    }
    R.steps(k, g, catchX, false);
    k.wait(Math.max(0, t0 + 1900 - k.t)).to(90, { sy: 0.88 }, "out").show("celebrate", 60);
    k.to(140, { y: g.floor - g.u * 0.08, sy: 1.05 }, "rise").to(160, { y: g.floor, sy: 0.92 }, "fall").to(300, { sy: 1 }, "spring");
    k.sound("chime");
    k.fx("star", 0, -g.u * 1.5).fx("sparkle", g.u * 0.3, -g.u * 1.3);
    k.propAt("star", k.t, {}).propAt("star", k.t + 500, { sx: 0.2, sy: 0.2, o: 0, y: g.floor - g.u * 0.7 }, "in");
    k.wait(500).show("standing", 140).wait(100);
  });

  add("Screen", "read-book", "Read a Tiny Book", ["sitting", "standing"], {}, (k, g) => {
    k.prop("book", "book", "body").prop("page", "page", "body");
    pose(k, "sitting", 180);
    const l = rel(g, "sitting", "lap");
    pop(k, "book", k.t, { x: l.x, y: l.y });
    let t = k.t + 500;
    for (let i = 0; i < 3; i += 1) {
      k.propAt("page", t, { x: l.x, y: l.y, o: 1, sx: 1 }).propAt("page", t + 300, { sx: 0.05 }, "in").propAt("page", t + 320, { o: 0 });
      t += 1100;
    }
    for (let i = 0; i < 6; i += 1) k.to(520, { r: i % 2 ? -2 : 3 }, "soft");
    k.to(200, { r: 0 }, "soft").fx("sparkle", g.u * 0.3, -g.u * 0.9);
    k.propAt("book", k.t, {}).propAt("book", k.t + 300, { sx: 0.1, o: 0 }, "in");
    k.wait(320).show("standing", 150).to(120, { sy: 1.04 }, "out").to(260, { sy: 1 }, "springSoft");
  });

  add("Screen", "sip", "Sip a Drink", ["standing"], {}, (k, g) => {
    k.prop("cup", "cup", "body");
    const h = rel(g, "standing", "near");
    const m = rel(g, "standing", "mouth");
    pop(k, "cup", 0, { x: h.x, y: h.y });
    k.wait(500);
    const t0 = k.t;
    k.propAt("cup", t0, {}).propAt("cup", t0 + 500, { x: m.x + g.u * 0.14, y: m.y + g.u * 0.06, r: -25 }, "soft")
      .propAt("cup", t0 + 1300, {}).propAt("cup", t0 + 1800, { x: h.x, y: h.y, r: 0 }, "soft");
    k.to(500, { r: -4 }, "soft").fx("steam", g.u * 0.2, -g.u * 1.0).wait(800).to(500, { r: 0 }, "soft");
    say(k, g, "Ahh!");
    bounce(k, g, 1, 300, 0.05);
    k.fx("steam", h.x, h.y - g.u * 0.15);
    hold(k, 500);
    gone(k, "cup", k.t);
    k.wait(280);
  });

  add("Screen", "selfie", "Selfie", ["wave", "love", "heart-eyes", "standing"], {}, (k, g) => {
    k.prop("phone", "phone", "body").prop("photo", "photo");
    pose(k, "wave", 140);
    const h = rel(g, "wave", "up");
    pop(k, "phone", k.t - 260, { x: h.x + g.u * 0.02, y: h.y + g.u * 0.12 });
    k.wait(300);
    for (const p of ["love", "heart-eyes"]) {
      // Poses, the flash, back to the phone.
      pose(k, p, 110).wait(250);
      k.fx("flash", h.x, h.y).sound("shutter", 0).wait(400);
      k.show("wave", 100).wait(200);
    }
    const ph = { x: k.now.x + g.u * 0.75, y: g.floor - g.u * 1.5 };
    pop(k, "photo", k.t, { x: ph.x, y: ph.y, r: 8 });
    k.fx("sparkle", g.u * 0.95, -g.u * 1.8);
    hold(k, 900);
    gone(k, "phone", k.t);
    gone(k, "photo", k.t + 200, 360);
    k.show("standing", 130).wait(400);
  });

  // ------------------------------------------------------------ Seasonal (by the Mac's date) and special

  add("Seasonal", "snowball", "Snowball Throw", ["snowball", "wave", "standing"], { season: "winter", room: { right: 3 } }, (k, g, r) => {
    k.prop("ball", "snowball");
    k.sound("jingle");
    shower(k, g, "flake", 10, 3200, k.now.x - g.u * 2, k.now.x + g.u * 3, g.floor - g.u * 2.6, g.floor - g.u * 2.2, r);
    pose(k, "snowball", 180);
    k.to(500, { sy: 0.97 }, "soft").to(300, { sy: 1 }, "soft");
    const b = spot(k, g, "snowball", "ball");
    k.to(200, { r: -5 }, "soft");
    k.show("wave", 60).to(120, { r: 8 }, "in");
    const t0 = k.t;
    const to = { x: b.x + g.u * 2.6, y: g.floor - g.u * 0.5 };
    k.propAt("ball", t0, { x: b.x, y: b.y, o: 1 });
    fling(k, "ball", t0, 800, b, to, g.u * 0.9, 360);
    k.propAt("ball", t0 + 820, { o: 0 });
    k.fxAt(t0 + 800, "splat", to.x, to.y).sound("thwack", 800);
    k.to(400, { r: 0 }, "springSoft").wait(Math.max(0, t0 + 900 - k.t));
    say(k, g, "Got it!");
    k.show("standing", 140);
    bounce(k, g, 2, 300, 0.06);
  });

  add("Seasonal", "snowman", "Build a Snowman", ["standing", "celebrate", "snowman"], { season: "winter", room: { right: 1.4 } }, (k, g, r) => {
    const parts = [["s1", "snow1"], ["s2", "snow2"], ["s3", "snow3"], ["hat", "snowhat"]];
    for (const [id, kind] of parts) k.prop(id, kind);
    k.sound("jingle");
    shower(k, g, "flake", 12, 5000, k.now.x - g.u * 1.5, k.now.x + g.u * 2, g.floor - g.u * 2.6, g.floor - g.u * 2.2, r);
    // Where the snowman stands in his snowman picture.
    const sx = k.now.x + g.u * 0.95;
    const ys = [g.floor, g.floor - g.u * 0.4, g.floor - g.u * 0.72, g.floor - g.u * 0.95];
    parts.forEach(([id], i) => {
      pop(k, id, k.t + 100, { x: sx, y: ys[i] });
      k.wait(400);
      k.to(100, { sy: 0.92 }, "out").to(260, { sy: 1 }, "springSoft");
    });
    R.jump(k, g, { h: g.u * 0.3, pose: "celebrate", land: "standing" });
    // The finished scene: his snowman picture (hat and present too).
    k.show("snowman", 220);
    for (const [id] of parts) gone(k, id, k.t - 200, 300);
    hold(k, 1600);
    k.show("standing", 160).wait(200);
  });

  add("Seasonal", "umbrella", "Umbrella in the Rain", ["umbrella", "standing"], { season: "rainy", room: { left: 1, right: 1 } }, (k, g, r) => {
    k.prop("cloud", "cloud").prop("sun", "sun");
    const cx = k.now.x;
    const cy = Math.max(g.u * 0.3, g.floor - g.u * 2.3);
    pop(k, "cloud", 0, { x: cx, y: cy, sx: 1.5, sy: 1.3 });
    shower(k, g, "rain", 24, 3600, cx - g.u * 0.8, cx + g.u * 0.8, cy + g.u * 0.2, cy + g.u * 0.3, r);
    k.wait(300);
    pose(k, "umbrella", 160);
    // A little splashy step each way (the umbrella picture faces the camera).
    for (const d of [0.25, -0.5, 0.25]) {
      k.to(500, { x: k.now.x + d * g.u, y: g.floor - g.u * 0.04, r: Math.sign(d) * 3 }, "soft").to(200, { y: g.floor, r: 0 }, "fall").fx("drop", 0, -g.u * 0.02);
    }
    k.wait(800);
    k.propAt("cloud", k.t, {}).propAt("cloud", k.t + 600, { x: cx + g.u * 1.5, o: 0 }, "in");
    k.propAt("sun", k.t + 300, { x: cx - g.u * 1, y: cy, o: 0, sx: 0.6, sy: 0.6 }).propAt("sun", k.t + 900, { o: 1, sx: 1, sy: 1, r: 40 }, "spring");
    k.wait(600).show("standing", 150);
    bounce(k, g, 1, 300, 0.06);
    gone(k, "sun", k.t + 300, 400);
    k.wait(700);
  });

  add("Seasonal", "sunglasses", "Cool Shades", ["standing"], { season: "summer" }, (k, g) => {
    k.prop("sun", "sun").prop("shades", "sunglasses", "body");
    const sx = clamp(k.now.x - g.u * 1.3, g.left, g.right);
    const sy = Math.max(g.u * 0.4, g.floor - g.u * 2.6);
    k.propAt("sun", 0, { x: sx, y: sy + g.u * 0.8, o: 0 }).propAt("sun", 700, { y: sy, o: 1 }, "out").propAt("sun", 4200, { r: 90 }, "linear");
    k.wait(500);
    const e = rel(g, "standing", "eyes");
    k.propAt("shades", k.t, { x: e.x, y: e.y - g.u * 1.2, o: 0 }).propAt("shades", k.t + 150, { o: 1 }).propAt("shades", k.t + 650, { y: e.y }, "spring");
    k.wait(600).to(90, { sy: 0.95 }, "out").to(260, { sy: 1 }, "springSoft");
    k.fx("star", e.x + g.u * 0.15, e.y - g.u * 0.05);
    k.to(500, { r: -5 }, "soft");
    hold(k, 1200);
    k.to(300, { r: 0 }, "springSoft");
    k.propAt("shades", k.t, {}).propAt("shades", k.t + 400, { y: e.y - g.u * 0.8, o: 0 }, "in");
    gone(k, "sun", Math.max(k.t, 4200), 400);
    k.wait(Math.max(400, 4650 - k.t));
  });

  add("Seasonal", "fireworks", "Fireworks", ["fireworks", "sparklers", "celebrate", "standing"], { season: "newyear" }, (k, g, r) => {
    pose(k, "fireworks", 160);
    k.sound("fireworks");
    const t0 = k.t;
    for (let i = 0; i < 6; i += 1) {
      const x = clamp(k.now.x + (r() - 0.5) * g.u * 5, g.left, g.right);
      const y = Math.max(g.u * 0.4, g.floor - g.u * (2.2 + r() * 1.4));
      k.fxAt(t0 + 450 * i, "trail", x, y + g.u * 0.6).fxAt(t0 + 450 * i + 200, i % 2 ? "burst2" : "burst", x, y);
    }
    hold(k, 1200);
    pose(k, "sparklers", 150);
    sway(k, 2, 5, 500);
    R.jump(k, g, { h: g.u * 0.35, pose: "celebrate", land: "standing" });
    k.wait(Math.max(0, t0 + 3000 - k.t));
  });

  add("Seasonal", "cake", "Birthday Cake", ["standing", "celebrate"], { room: { right: 1.2 } }, (k, g) => {
    k.prop("cake", "cake").prop("flames", "flames");
    const cx = k.now.x + g.u * 0.8;
    pop(k, "cake", 0, { x: cx, y: g.floor });
    k.propAt("flames", 300, { x: cx, y: g.floor, o: 0 }).propAt("flames", 500, { o: 1 });
    for (let i = 0; i < 6; i += 1) k.propAt("flames", 600 + 200 * i, { sy: i % 2 ? 1 : 0.85 }, "soft");
    k.wait(600);
    // A big breath in, and a blow.
    k.to(700, { sy: 1.07, sx: 0.98, r: -3 }, "soft").wait(200);
    k.to(140, { sy: 0.95, sx: 1.04, r: 8 }, "out");
    k.propAt("flames", k.t, { o: 1 }).propAt("flames", k.t + 200, { o: 0, sx: 0.4 }, "in");
    k.fxAt(k.t + 150, "smoke", cx - g.u * 0.1, g.floor - g.u * 0.6).fxAt(k.t + 250, "smoke", cx + g.u * 0.1, g.floor - g.u * 0.62);
    k.to(400, { r: 0, sy: 1, sx: 1 }, "spring");
    k.sound("applause");
    k.fx("confetti", g.u * 0.4, -g.u * 1.4);
    R.jump(k, g, { h: g.u * 0.35, pose: "celebrate", land: "standing" });
    gone(k, "cake", k.t + 200, 360);
    k.wait(600);
  });

  add("Seasonal", "pumpkin", "Pumpkin Surprise", ["pumpkin", "celebrate", "laugh", "standing"], { season: "halloween" }, (k, g) => {
    pose(k, "pumpkin", 170);
    k.sound("spooky");
    hold(k, 700);
    k.fx("bat", g.u * 0.4, -g.u * 0.9).fx("bat", -g.u * 0.2, -g.u * 1.2);
    k.to(60, { sy: 0.9 }, "out").show("celebrate", 50).fx("bang", 0, -g.u * 1.5);
    R.arc(k, 360, { x: k.now.x, y: g.floor }, g.u * 0.35, { stretch: 1.5 });
    k.to(80, { sy: 0.84, sx: 1.1 }, "out").to(320, { sy: 1, sx: 1 }, "spring");
    pose(k, "laugh", 130);
    bounce(k, g, 2, 240, 0.04);
    pose(k, "pumpkin", 150);
    hold(k, 700);
    k.show("standing", 150);
  });

  add("Seasonal", "holiday-hat", "Holiday Hat and Sled", ["standing", "celebrate", "sled"], { season: "december", room: { right: 2.4 } }, (k, g, r) => {
    k.prop("hat", "santahat", "body");
    k.sound("jingle");
    shower(k, g, "flake", 10, 4200, k.now.x - g.u * 1.5, k.now.x + g.u * 3, g.floor - g.u * 2.6, g.floor - g.u * 2.2, r);
    const top = rel(g, "standing", "top");
    k.propAt("hat", k.t, { x: top.x, y: top.y - g.u * 1, o: 0, r: -20 }).propAt("hat", k.t + 150, { o: 1 }).propAt("hat", k.t + 650, { y: top.y + g.u * 0.04, r: 0 }, "spring");
    k.wait(650).to(90, { sy: 0.92 }, "out").to(260, { sy: 1 }, "springSoft");
    R.jump(k, g, { h: g.u * 0.3, pose: "celebrate", land: "standing" });
    // Then off on a sled (his sled picture).
    gone(k, "hat", k.t, 200);
    k.show("sled", 200).heading(1);
    const x0 = k.now.x;
    k.to(1600, { x: x0 + g.u * 2 }, "out");
    k.fx("spray", -g.u * 0.6, 0);
    k.heading(0).wait(300).show("standing", 160).to(300, { sy: 1 }, "springSoft");
  });

  add("Seasonal", "flowers", "Spring Flowers", ["standing", "love"], { season: "spring", room: { left: 1, right: 1 } }, (k, g, r) => {
    const ids = [["f1", "flower1", -0.8], ["f2", "flower2", 0.65], ["f3", "flower3", -0.45], ["f4", "flower1", 0.95]];
    ids.forEach(([id, kind, dx], i) => { k.prop(id, kind); pop(k, id, 200 + 300 * i, { x: k.now.x + g.u * dx, y: g.floor }, 450); });
    k.sound("chime", 200);
    shower(k, g, "petal", 6, 2000, k.now.x - g.u * 1, k.now.x + g.u * 1, g.floor - g.u * 1.8, g.floor - g.u * 1.4, r);
    k.wait(1300);
    // A sniff of the nearest.
    k.to(500, { r: 8, sy: 0.96 }, "soft").fx("heart", g.u * 0.7, -g.u * 0.9).wait(300).to(400, { r: 0, sy: 1 }, "springSoft");
    pose(k, "love", 150);
    hold(k, 800);
    ids.forEach(([id], i) => gone(k, id, k.t + 100 * i, 300));
    k.show("standing", 150).wait(500);
  });

  add("Seasonal", "leaves", "Autumn Leaves", ["standing", "celebrate", "laugh"], { season: "autumn", room: { right: 1.6 } }, (k, g, r) => {
    k.prop("pile", "leafpile");
    shower(k, g, "leaf", 10, 3000, k.now.x - g.u * 1.5, k.now.x + g.u * 2.2, g.floor - g.u * 2.4, g.floor - g.u * 1.8, r);
    const px = k.now.x + g.u * 1.1;
    pop(k, "pile", 0, { x: px, y: g.floor }, 500);
    k.wait(900);
    R.jump(k, g, { h: g.u * 0.55, x: px, pose: "celebrate", land: "laugh", dust: false });
    for (let i = 0; i < 6; i += 1) k.fx("leaf", (r() - 0.5) * g.u * 1.2, -g.u * (0.8 + r() * 0.6));
    k.propAt("pile", k.t - 300, {}).propAt("pile", k.t, { sy: 0.7, sx: 1.2 }, "out").propAt("pile", k.t + 400, { sy: 1, sx: 1 }, "spring");
    bounce(k, g, 2, 260, 0.04);
    k.show("standing", 150);
    gone(k, "pile", k.t + 300, 360);
    k.wait(700);
  });

  add("Seasonal", "countdown", "New Year Countdown", ["sparklers", "fireworks", "celebrate", "standing"], { season: "newyear" }, (k, g, r) => {
    pose(k, "sparklers", 160);
    for (const n of ["3", "2", "1"]) { k.fx("bubble", 0, -g.u * 1.7, { text: n }); sway(k, 1, 4, 600); }
    k.sound("fireworks");
    say(k, g, "Happy New Year!");
    k.fx("confetti", 0, -g.u * 1.5);
    const t0 = k.t;
    for (let i = 0; i < 4; i += 1) {
      k.fxAt(t0 + 350 * i, i % 2 ? "burst" : "burst2", clamp(k.now.x + (r() - 0.5) * g.u * 4, g.left, g.right), Math.max(g.u * 0.4, g.floor - g.u * (2.3 + r())));
    }
    R.jump(k, g, { h: g.u * 0.4, pose: "celebrate", land: "fireworks" });
    hold(k, 900);
    k.show("standing", 150).wait(200);
  });

  add("Seasonal", "party-popper", "Party Popper", ["confetti", "celebrate", "standing"], {}, (k, g) => {
    k.prop("popper", "popper", "body");
    const h = rel(g, "standing", "near");
    pop(k, "popper", 0, { x: h.x, y: h.y, r: 20 });
    k.wait(500).to(300, { sy: 0.95, r: -3 }, "anticipate");
    k.propAt("popper", k.t, {}).propAt("popper", k.t + 100, { r: 35, y: h.y - g.u * 0.05 }, "out");
    k.fxAt(k.t + 60, "confetti", k.now.x + h.x + g.u * 0.2, k.now.y + h.y - g.u * 0.5).fxAt(k.t + 160, "confetti", k.now.x + h.x + g.u * 0.4, k.now.y + h.y - g.u * 0.9);
    k.sound("pop", 60).sound("applause", 400);
    k.to(120, { sy: 1.04, r: 4 }, "out").to(300, { sy: 1, r: 0 }, "spring");
    gone(k, "popper", k.t + 200);
    pose(k, "confetti", 140);
    R.jump(k, g, { h: g.u * 0.35, pose: "celebrate", land: "standing" });
  });

  add("Seasonal", "good-morning", "Good Morning", ["yawn", "celebrate", "wave", "standing"], { time: "morning" }, (k, g) => {
    k.prop("sun", "sun");
    const sx = clamp(k.now.x + g.u * 1.3, g.left, g.right);
    k.propAt("sun", 0, { x: sx, y: g.floor + g.u * 0.2, o: 0 }).propAt("sun", 300, { o: 1 }).propAt("sun", 2200, { y: g.floor - g.u * 1.8, r: 60 }, "out");
    pose(k, "yawn", 170);
    k.sound("yawn");
    k.to(800, { sy: 1.03 }, "soft");
    k.show("celebrate", 160).to(700, { sy: 1.08, sx: 0.96 }, "soft").to(300, { sy: 1, sx: 1 }, "springSoft");
    pose(k, "wave", 140);
    say(k, g, "Good morning!");
    sway(k, 2, 6, 440);
    k.show("standing", 150);
    gone(k, "sun", Math.max(k.t, 2300), 400);
    k.wait(Math.max(300, 2750 - k.t));
  });

  add("Seasonal", "good-night", "Good Night", ["wave", "yawn", "standing"], { time: "night", endRest: true }, (k, g, r) => {
    k.prop("moon", "moon");
    const mx = clamp(k.now.x - g.u * 1.2, g.left, g.right);
    const my = Math.max(g.u * 0.4, g.floor - g.u * 2.4);
    pop(k, "moon", 0, { x: mx, y: my, r: -10 }, 600);
    shower(k, g, "star", 6, 3200, k.now.x - g.u * 2, k.now.x + g.u * 2, my - g.u * 0.2, my + g.u * 0.6, r);
    pose(k, "wave", 160);
    say(k, g, "Good night!");
    for (let i = 0; i < 2; i += 1) k.to(400, { r: 5 }, "soft").to(400, { r: -4 }, "soft");
    k.to(300, { r: 0 }, "soft");
    pose(k, "yawn", 160);
    k.sound("yawn");
    k.to(900, { sy: 1.03 }, "soft").to(300, { sy: 1 }, "soft");
    gone(k, "moon", k.t, 500);
    k.show("standing", 150).wait(200);
    k.to(110, { sy: 0.92, sx: 1.05 }, "in").show(REST, 160).to(340, { sy: 1, sx: 1 }, "springSoft");
    k.fx("zzz", g.u * 0.3, -g.u * 0.9);
    k.wait(400);
  });

  const BY = Object.fromEntries(LIST.map((m) => [m.id, m]));
  const IDS = LIST.map((m) => m.id);

  // ---------------------------------------------------------------- seasons and times

  // By the Mac's own date and clock (northern-hemisphere seasons).
  function seasonsOf(date) {
    const d = date instanceof Date ? date : new Date(date);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const out = new Set();
    if (m === 12 || m <= 2) out.add("winter");
    if (m >= 3 && m <= 5) out.add("spring");
    if (m >= 6 && m <= 8) out.add("summer");
    if (m >= 9 && m <= 11) out.add("autumn");
    if ((m >= 3 && m <= 5) || (m >= 9 && m <= 11)) out.add("rainy");
    if (m === 10) out.add("halloween");
    if (m === 12) out.add("december");
    if ((m === 12 && day >= 30) || (m === 1 && day <= 2)) out.add("newyear");
    return out;
  }
  function timeOf(date) {
    const h = (date instanceof Date ? date : new Date(date)).getHours();
    if (h >= 5 && h < 11) return "morning";
    if (h >= 20 || h < 5) return "night";
    return "day";
  }
  function fits(m, date) {
    if (m.season && !seasonsOf(date).has(m.season)) return false;
    if (m.time && timeOf(date) !== m.time) return false;
    return true;
  }
  // The tricks that fit right now.
  const eligible = (date) => LIST.filter((m) => fits(m, date || new Date())).map((m) => m.id);

  // For "Always moving" when a trick is due: one of these most of the time,
  // sometimes one of the classics (null: roam.js picks a classic).
  const CLASSIC_SHARE = 0.2;
  function choose(date, random, last) {
    const r = typeof random === "function" ? random : Math.random;
    if (r() < CLASSIC_SHARE) return null;
    const list = eligible(date).filter((id) => !(last || []).includes(id));
    if (!list.length) return null;
    return list[Math.floor(r() * list.length) % list.length];
  }

  // ---------------------------------------------------------------- planning

  // A trick from where he is now: down to the floor if he's up somewhere,
  // to a spot with room for it, the move, then every prop gone and standing.
  function plan(id, g, pose0) {
    const m = BY[id];
    if (!m) return null;
    const r = typeof g.random === "function" ? g.random : Math.random;
    const k = R.track(g.pos, g.poses, pose0, g);
    if (!R.atFloor(g)) {
      R.airUp(k); // (1.5.1: up into the flying picture, not standing in mid-air)
      if (g.floor - g.pos.y < g.u * 1.5) R.touchDown(k, g, g.pos.x);
      else R.flyTo(k, g, { x: g.pos.x, y: g.floor }, false);
    }
    R.getUp(k);
    const lo = g.left + (m.room.left || 0) * g.u;
    const hi = g.right - (m.room.right || 0) * g.u;
    const want = lo <= hi ? clamp(k.now.x, lo, hi) : (g.left + g.right) / 2;
    if (Math.abs(want - k.now.x) > 2) R.steps(k, g, want, Math.abs(want - k.now.x) > (g.right - g.left) * 0.35);
    k.heading(0);
    const start = k.t;
    m.run(k, { ...g, pos: k.now }, r);
    // Tidy: any prop still showing fades out, and he ends on the floor.
    k.heading(0);
    if (k.now.y < g.floor - 1) R.touchDown(k, g, clamp(k.now.x, g.left, g.right));
    if (Math.abs(k.now.r) > 0.5 || k.now.sx !== 1 || k.now.sy !== 1) k.to(260, { r: 0, sx: 1, sy: 1 }, "springSoft");
    if (!m.endRest && k.pose !== k.shows("standing")) k.show("standing", 150).to(200, { sy: 1 }, "soft");
    const x = clamp(k.now.x, g.left, g.right);
    if (Math.abs(x - k.now.x) > 1) R.steps(k, g, x, false);
    const plan = k.done(id);
    plan.trick = { id, name: m.name, cat: m.cat, from: start };
    return fadeProps(plan);
  }

  // Every prop ends invisible before the move does (the actor also removes it).
  function fadeProps(plan) {
    for (const p of plan.props) {
      const last = p.frames[p.frames.length - 1];
      if (!last) continue;
      if (last.o > 0) {
        const t = Math.min(last.t, Math.max(0, plan.duration - 240));
        p.frames.push({ ...last, t: Math.max(t + 1, Math.min(plan.duration, t + 240)), o: 0, e: R.EASE.in });
      }
      p.frames = p.frames.filter((f) => f.t <= plan.duration);
    }
    return plan;
  }

  const api = { CATEGORIES, LIST, IDS, BY, H, has: (id) => Boolean(BY[id]), plan, eligible, choose, seasonsOf, timeOf, fits, CLASSIC_SHARE };
  if (node) module.exports = api;
  else root.PilotTricks = api;
})(typeof window !== "undefined" ? window : globalThis);
