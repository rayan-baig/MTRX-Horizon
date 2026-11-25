/* Hands-on app demos (1.30.0). Pretend data only: nothing is saved or sent.
   Each demo is a short guided story the visitor taps through. */
(function () {
  "use strict";
  var stage = document.getElementById("demo");
  if (!stage) return;
  var app = stage.getAttribute("data-app");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, cls, on) {
    var b = el("button", "btn " + (cls || "btn-solid"), text);
    b.type = "button";
    b.addEventListener("click", on);
    return b;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduce ? 0 : ms); }); }

  // A guide line above the phone, and the phone itself.
  stage.textContent = "";
  var guide = el("p", "demo-guide");
  var phone = el("div", "demo-phone");
  var screen = el("div", "demo-screen");
  var bar = el("div", "demo-bar");
  phone.appendChild(screen);
  stage.appendChild(guide);
  stage.appendChild(phone);
  stage.appendChild(bar);
  function say(t) { guide.textContent = t; }
  function clear() { screen.textContent = ""; bar.textContent = ""; }
  function restart(fn) { bar.appendChild(btn("Start again", "btn-outline", fn)); }
  function toast(t) {
    var n = el("div", "demo-toast", t);
    screen.appendChild(n);
    setTimeout(function () { n.classList.add("go"); }, reduce ? 0 : 1600);
  }

  /* ---------------- RankUp: chores → accept → coins and a level up ---- */
  function rankup() {
    clear();
    var coins = 40, xp = 60;
    say("Step 1 of 3: you're Ava. Tap Done on a chore you finished.");
    var head = el("div", "ru-head");
    var who = el("b", null, "Ava");
    var coin = el("span", "ru-coins", "🪙 " + coins);
    head.appendChild(who); head.appendChild(coin);
    var lvl = el("p", "ru-lvl", "Level 3");
    var track = el("div", "ru-xp"); var fill = el("i"); fill.style.width = xp + "%"; track.appendChild(fill);
    screen.appendChild(head); screen.appendChild(lvl); screen.appendChild(track);
    var list = el("ul", "ru-list");
    [["🛏️", "Make your bed", 5], ["🐕", "Feed the dog", 10], ["🍽️", "Clear the table", 10]].forEach(function (c) {
      var li = el("li");
      li.appendChild(el("span", null, c[0] + " " + c[1]));
      var d = btn("Done", "btn-solid btn-small", function () {
        d.disabled = true; d.textContent = "Sent ✓"; li.classList.add("sent");
        say("Step 2 of 3: now you're the grown-up. Accept Ava's chore.");
        bar.textContent = "";
        bar.appendChild(btn("Accept " + c[1].toLowerCase(), "btn-solid", function () {
          bar.textContent = "";
          coins += c[2]; xp += 45; coin.textContent = "🪙 " + coins;
          coin.classList.add("pop");
          fill.style.width = Math.min(xp, 100) + "%";
          li.classList.add("done");
          if (xp >= 100) {
            lvl.textContent = "Level 4 🎉";
            toast("Level up! Ava is now level 4");
            say("Step 3 of 3: coins flew in and Ava levelled up. That's RankUp!");
            restart(rankup);
          } else {
            say("Nice! +" + c[2] + " coins. Tap Done on another chore.");
          }
        }));
      });
      li.appendChild(d); list.appendChild(li);
    });
    screen.appendChild(list);
  }

  /* ---------------- CyberLogix: fridge warms → text → fixed → food ------ */
  function cyberlogix() {
    clear();
    var temp = 37;
    say("Step 1 of 4: this fridge is fine at 37°F. Pretend the door was left open.");
    var card = el("div", "cl-card");
    card.appendChild(el("b", null, "Walk-in fridge"));
    var t = el("span", "cl-temp", temp + "°F");
    var st = el("span", "cl-ok", "Fine");
    card.appendChild(t); card.appendChild(st);
    screen.appendChild(card);
    var limit = el("p", "cl-limit", "Limit: 41°F");
    screen.appendChild(limit);
    bar.appendChild(btn("Leave the door open", "btn-solid", async function () {
      bar.textContent = "";
      say("Step 2 of 4: watching it warm up…");
      for (var i = 0; i < 9; i++) {
        temp += 1.3; t.textContent = temp.toFixed(1) + "°F";
        if (temp > 41) { st.textContent = "Too warm"; st.className = "cl-bad"; }
        await wait(260);
      }
      var sms = el("div", "cl-sms");
      sms.appendChild(el("small", null, "Text message"));
      sms.appendChild(el("p", null, "CyberLogix: Walk-in fridge is " + temp.toFixed(1) + "°F, over the 41°F limit. Check the door. Reply 1 if you're on it."));
      screen.appendChild(sms);
      say("Step 3 of 4: your phone gets a text. Tap I'm on it.");
      bar.appendChild(btn("I'm on it", "btn-solid", async function () {
        bar.textContent = "";
        sms.remove();
        say("Shutting the door… it's cooling down.");
        while (temp > 38) { temp -= 1.6; t.textContent = temp.toFixed(1) + "°F"; await wait(220); }
        st.textContent = "Fine"; st.className = "cl-ok";
        say("Step 4 of 4: it's cold again. Was the food OK?");
        bar.appendChild(btn("Food kept", "btn-solid", function () {
          bar.textContent = "";
          var rec = el("div", "cl-rec");
          rec.appendChild(el("b", null, "Saved for the inspector"));
          rec.appendChild(el("p", null, "Too warm for a few minutes · Maya was on it · Food kept"));
          screen.appendChild(rec);
          say("Everything is written down for you. That's CyberLogix!");
          restart(cyberlogix);
        }));
        bar.appendChild(btn("Thrown away", "btn-outline", function () {
          bar.textContent = "";
          var rec = el("div", "cl-rec");
          rec.appendChild(el("b", null, "Insurance pack ready"));
          rec.appendChild(el("p", null, "Times, readings and who did what, ready to send"));
          screen.appendChild(rec);
          say("It makes a pack for your insurer. That's CyberLogix!");
          restart(cyberlogix);
        }));
      }));
    }));
  }

  /* ---------------- OmniArmor: enter dates → statuses turn green ------- */
  function omniarmor() {
    clear();
    say("Step 1 of 2: this restaurant has 3 checks. Tap “Done today” on each red or amber one.");
    var score = el("p", "oa-score");
    screen.appendChild(score);
    var list = el("ul", "oa-list");
    var checks = [["Fridge temperature log", "bad", "3 days overdue"],
                  ["Fire extinguisher check", "warn", "Due in 2 days"],
                  ["Staff hand-washing training", "ok", "Fine for 41 days"]];
    function count() {
      var ok = list.querySelectorAll(".oa-ok").length;
      score.textContent = ok + " of 3 checks are fine";
      if (ok === 3) {
        toast("All clear! 🟢");
        say("Step 2 of 2: everything's green, and the dates are saved for inspectors. That's OmniArmor!");
        bar.textContent = ""; restart(omniarmor);
      }
    }
    checks.forEach(function (c) {
      var li = el("li", "oa-" + c[1]);
      var txt = el("div");
      txt.appendChild(el("b", null, c[0]));
      var when = el("span", null, c[2]);
      txt.appendChild(when);
      li.appendChild(txt);
      if (c[1] !== "ok") {
        var b = btn("Done today", "btn-solid btn-small", function () {
          li.className = "oa-ok"; when.textContent = "Done today · next due later";
          b.remove(); count();
        });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    screen.appendChild(list);
    count();
  }

  /* ---------------- Genesis: idea → plan → tick a step ----------------- */
  function genesis() {
    clear();
    say("Step 1 of 3: write your idea in a few words (or use the example).");
    var form = el("form", "gn-form");
    var input = el("input"); input.type = "text"; input.maxLength = 60;
    input.placeholder = "e.g. A dog-walking club for my street";
    input.setAttribute("aria-label", "Your idea");
    form.appendChild(input);
    form.appendChild(btn("Make my plan", "btn-solid", function () { form.requestSubmit ? form.requestSubmit() : go(); }));
    screen.appendChild(form);
    form.addEventListener("submit", function (e) { e.preventDefault(); go(); });
    function go() {
      var idea = input.value.trim() || "A dog-walking club for my street";
      screen.textContent = "";
      screen.appendChild(el("b", "gn-idea", "💡 " + idea));
      say("Step 2 of 3: here's your plan. Tick a step when you finish it.");
      var steps = ["Pick a name", "Ask 3 people if they'd use it", "Make a simple poster", "Try it for one week"];
      var list = el("ul", "gn-steps");
      var done = 0;
      var prog = el("p", "gn-prog", "0 of 4 done");
      steps.forEach(function (s) {
        var li = el("li");
        var b = btn("○ " + s, "gn-tick", function () {
          if (li.classList.contains("done")) return;
          li.classList.add("done"); b.textContent = "✓ " + s; done++;
          prog.textContent = done + " of 4 done";
          if (done === 1) {
            toast("Nice! 1 step done");
            say("Step 3 of 3: that's how Genesis works. The real one is free to use.");
            bar.textContent = "";
            var real = el("a", "btn btn-solid", "Open the real Genesis →");
            real.href = stage.getAttribute("data-genesis");
            bar.appendChild(real);
            restart(genesis);
          }
        });
        li.appendChild(b); list.appendChild(li);
      });
      screen.appendChild(prog); screen.appendChild(list);
    }
  }

  /* ---------------- Orbyt: pick a path → note → sent (pretend) --------- */
  function orbyt() {
    clear();
    say("Step 1 of 3: what do you want to do?");
    var paths = [["💡", "I have an idea"], ["🚀", "I want to try the apps"], ["🤝", "I run a business"]];
    var list = el("div", "ob-paths");
    paths.forEach(function (p) {
      list.appendChild(btn(p[0] + " " + p[1], "btn-outline ob-path", function () { note(p[1]); }));
    });
    screen.appendChild(list);
    function note(path) {
      screen.textContent = "";
      screen.appendChild(el("b", "ob-pick", path));
      say("Step 2 of 3: write one short line (this demo doesn't send anything).");
      var ta = el("textarea"); ta.rows = 3; ta.maxLength = 140;
      ta.placeholder = "e.g. An app that reminds kids to drink water";
      ta.setAttribute("aria-label", "Your note");
      screen.appendChild(ta);
      bar.textContent = "";
      bar.appendChild(btn("Send (pretend)", "btn-solid", function () {
        screen.textContent = "";
        var ok = el("div", "ob-sent");
        ok.appendChild(el("b", null, "Sent. ✓"));
        ok.appendChild(el("p", null, "In the real Orbyt, a real person reads it and replies within 7 days."));
        screen.appendChild(ok);
        say("Step 3 of 3: that's Orbyt! Ready to send a real one?");
        bar.textContent = "";
        var real = el("a", "btn btn-solid", "Open the real Orbyt →");
        real.href = stage.getAttribute("data-orbyt");
        bar.appendChild(real);
        restart(orbyt);
      }));
    }
  }

  /* ---------------- Pilot: tap a question → instant answer ------------- */
  function pilot() {
    clear();
    say("Tap a question to see how Pilot answers straight away.");
    var bot = el("div", "pl-bot");
    var img = el("img"); img.src = "/static/pilot/pilot-robot-112.webp"; img.alt = ""; img.width = 72; img.height = 72;
    bot.appendChild(img);
    bot.appendChild(el("p", "pl-hi", "Hi! I'm Pilot. What would you like to know?"));
    screen.appendChild(bot);
    var chat = el("div", "pl-chat");
    screen.appendChild(chat);
    var qa = [["What can you do?", "I explain pages, answer questions, and point you to the right button. On the apps I use your own data, like which chores are waiting."],
              ["Do I need an AI key?", "No! Lots of answers work straight away. Add a grown-up's AI key only if you want me to answer anything at all."],
              ["Is there a Mac app?", "Yes. Pilot for Mac walks, flies and climbs on your screen, and there's a free version that runs on your Mac."]];
    var row = el("div", "pl-qs");
    qa.forEach(function (q) {
      row.appendChild(btn(q[0], "btn-outline btn-small", function () {
        chat.appendChild(el("p", "pl-you", q[0]));
        var a = el("p", "pl-ans", "…");
        chat.appendChild(a);
        setTimeout(function () { a.textContent = q[1]; }, reduce ? 0 : 500);
      }));
    });
    bar.appendChild(row);
  }

  var demos = { rankup: rankup, cyberlogix: cyberlogix, omniarmor: omniarmor,
                genesis: genesis, orbyt: orbyt, pilot: pilot };
  (demos[app] || pilot)();
})();
