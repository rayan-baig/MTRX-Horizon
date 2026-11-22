## Pilot for Mac {{VERSION}}

**Fixes for what an independent check found in 1.5.0: his feet no longer slide, pictures really fade, no standing in mid-air, and these notes now say only what's true.**

Pilot is the MTRX Horizyn AI assistant: a friendly robot that sits on top of everything on your Mac. Click it to chat, get help with writing and code, or have it look at your screen when you ask.

### Which one do I download?

There are two apps. Both have the robot, all the moves and tricks, the voice and sounds, copy and paste, link reading and screen access.

- **[Pilot Free (.dmg)]({{FREE_DMG_URL}})**: free AI that runs on your Mac. No keys, no account, nothing you type leaves your Mac, and it works offline once set up. It uses two free apps, Ollama for chat and Draw Things for pictures, and walks you through installing them. Videos aren't available in Pilot Free.
- **[Pilot (.dmg)]({{DMG_URL}})**: use your own AI key (OpenAI, Claude, Gemini, or any compatible API; your AI provider bills you directly and MTRX never sees your key), including picture and video keys. Free mode is in there too, if you'd rather not use a key.

You can install both: they have different names and keep separate settings. Each file works on every Mac: Apple Silicon and Intel, macOS 12 or newer. Free mode runs best on Apple Silicon (M1 or newer).

### What's new in 1.5.1

An independent check of 1.5.0 found that some of its notes weren't true, and a few rough edges. This release fixes them. The numbers below come from logging every frame of real moves in the app (the smoke test does this on each build).

- **His feet don't slide any more.** In 1.5.0 he glided along at a steady speed while each walking picture showed, so the foot on the ground slid about 32 points per picture. Now he walks in steps: he stays still while a foot is down and moves on as the picture changes, the way a drawn walk works. Measured: the planted foot moves at most about 2 points while a picture shows, walking either way and running. The catch: with only two walking pictures, he moves on in small hops, about two a second. A smoother walk needs more pictures (see the end of this section).
- **Pictures really fade now.** 1.5.0 said the old picture fades away on top of the new one, but a style rule hid it straight away, so every change was a hard cut. Now the old picture fades out over about a seventh of a second (logged frame by frame: drawn and fading, down to almost nothing). Steps within a walk, run or climb are still clean cuts on purpose.
- **No standing in mid-air.** Pushing off the wall showed the standing picture hanging in the air for over half a second. Now he crouches against the wall, jumps off in the jump picture and comes down in the landing picture. In Climb and Wave he pushes off into a hover and waves while flying. Being dropped in the air, and a few classic tricks, use the flying or jump picture too. Measured: no frames with the standing picture up in the air.
- **Climbing looks less like a sticker.** On each step he holds still while gripping, leans out from the wall a little as he reaches, and goes up only on the pull. If a second climbing picture (climb2) is added, his hands and feet take turns.
- **Ready for more walking pictures.** If more pictures are added (walk3, walk4 and so on, and climb2), Pilot uses them in turn automatically, and tools/mirror_poses.py makes their left-facing copies.
- **Cleaner left-facing pictures.** The faint leftover marks beside the P on his chest are gone, and his halo's colours stay the same way round when he turns (pink on the left, cyan on the right). Before, they swapped sides.
- **Smaller fixes.** He now stops properly between two walks instead of flashing the standing picture for a split second. The "Pilot needs your AI key." tooltip only comes up when you point at him, not when he walks under a still pointer. When he's resting, Pilot checks where the pointer is 5 times a second instead of 20, to save power. While he moves, it's still 20 times a second. His positions are rounded once, to whole Retina pixels.
- **Clicking him while he moves.** The test build now also clicks him mid-walk and mid-run on a real Mac, using real system mouse clicks through the see-through overlay (not only Playwright's clicks straight into the window), if the build Mac allows it. One limit remains: a click made the very instant the pointer reaches him can miss, because Pilot needs a moment to notice the pointer before it takes the click (a tenth of a second is plenty).

**Still waiting on new pictures.** The two walking pictures both have the same leg in front (his right leg, on your left), so whichever way he walks, the same leg always leads, and with two pictures the walk moves in small hops. Real fixes are a 4-picture walk (left foot down, passing, right foot down, passing) and a second climbing picture. The code is ready for both, so adding the files is enough.

**Check the click yourself (30 seconds).** Open Pilot and wait for him to start walking (pick Always moving from the robot head in the menu bar if he's resting). Move the pointer onto him while he walks, stop for a moment, and click. The chat should open. Then click the empty desktop where he was a few seconds ago: Finder (or whatever app is there) should get that click, not Pilot.

### What was new in 1.5.0 (corrected)

These notes were changed in 1.5.1. The first 1.5.0 notes claimed some things that weren't true, as marked below.

- **Clicking him while he moves.** Pilot followed him as he moved, so clicking him mid-walk, mid-climb or mid-trick opened the chat. (The original notes said *always*. That was too strong: a click the instant the pointer arrives on him can still miss.)
- **Sharper on Retina screens.** His pictures were drawn at exactly their own size, so they were crisp instead of slightly soft and didn't shimmer when he stopped. His shadow and glow stopped flashing at each start and stop. (The original notes also said the old picture faded away on top of the new one. It didn't: a style rule hid it at once, so every change was a hard cut. Fixed in 1.5.1. And his halo's colours swapped sides on the left-facing pictures. Also fixed in 1.5.1.)
- **Walking.** A steady rhythm of about two steps a second, a gentle start and stop, a slight rise and dip with each step, no leaning or wobbling. He walked and ran facing the way he was going, both ways (before, going left, he slid sideways facing you), and turned round standing up. Now and then he stopped to look around. (The original notes said his feet stayed put instead of sliding. They didn't: he glided at a steady speed, so the planted foot slid about 32 points per picture. Fixed in 1.5.1.)
- **Smoother moves.** Moves were eased in and out, flights glided with a gentle bob, and longer falls took longer. (The original notes said there were no sudden jerks at all. That was too strong: the check found a few changes of speed and an occasional slow frame.)
- **Climbing.** He climbed the side of the screen side-on, facing the edge, with his hands and feet on it, on either side. He got off by climbing back down, pushing off to a landing, or flying away. (Pushing off showed the standing picture hanging in mid-air for over half a second. Fixed in 1.5.1.)

### What was new in 1.4.0

- **Free mode.** Pilot's brain can run on your Mac with the free Ollama app. Pilot shows you where to download it (it opens the page in your browser; Pilot never installs anything by itself), notices when it's running, and a **Download brain** button gets a brain that fits your Mac's memory, with a progress bar. Any brain you already have in Ollama is listed too. The window says **Free mode · on your Mac**.
- **Pictures on your Mac** with the free Draw Things app: turn on its API Server and ask Pilot for a picture. It shows up in the chat with a Save button.
- **Actions in Free mode**: copy, open a website, notes and pictures work with brains that can use them, and Pilot still asks first every time. Other brains just chat.
- **Two editions**: Pilot Free and Pilot, as above.

### Set up Free mode (about 10 minutes, once)

1. Open Pilot's settings (the gear) and press **Download Ollama (free)**. Install Ollama from the download and open it once.
2. Back in Pilot, press **Download brain** and wait for the bar to finish (a few GB, once).
3. Pictures, if you like: press **Get Draw Things (free)**, install it from the Mac App Store, open it and let it download a model. Then in Draw Things' settings turn on **API Server** (HTTP, port 7860) and leave Draw Things open.

### What was new in 1.3.0

- **Smoother moves.** Springy landings, a little crouch before every jump, real arcs through the air, a gentle bob as he walks, and steps that keep time with how fast he goes.
- **80 new tricks**, from dances and sports to magic, moods, playing with your screen, and seasonal ones (snow in winter, a pumpkin in October, fireworks at New Year). Pick any of them from **Play a Trick** in the menu, or let him surprise you every minute or two.
- **The owner's new pose pictures**: dozens more ways for him to stand, play and wave.
- **Copy and paste**: paste a screenshot or a picture straight into the chat, links you can click (Pilot asks first), and right-click to copy text, links and pictures.
- **Read this link**: paste a web address and Pilot can read the page for you.
- **A voice, if you want one**: turn on Speak replies and he reads his answers aloud in your Mac's own voice. It's off unless you turn it on.
- **Little sounds** with some tricks, soft and short. Turn them off, change the volume or set quiet hours in Settings.

### What was new in 1.2.0

- **Always moving became the default setting.** The robot walks and runs along the bottom of your screen, flies across to another spot and lands like a superhero, and climbs up the screen edges and drops or flies back down. He goes somewhere new every time, in both directions, with only short pauses, sometimes a look at your mouse or a wave. About every couple of minutes he does a trick or a sport: a backflip, a cheer, a knee slide, football, soccer, tennis or an energy ball.
- **Energy now has three choices: Calm, Relaxed and Always moving.** Calm: he rests. Relaxed: a move now and then, like Pilot 1.1. Always moving: he wanders on his own. Pick one from the robot head in the menu bar, by right-clicking the robot, or in settings. If you had turned Calm Mode on, you keep Calm. If your Mac is set to reduce motion, he rests unless you pick another choice.
- **He still keeps out of your way.** Clicks go straight through to your apps except on the robot himself, he never covers the menu bar, and he doesn't stop where your mouse is. He stays put next to the chat while it's open, and keeps still while a video or game is full screen, while you drag him, while he's hidden, and while you're away from your Mac or it's locked. He waves when you come back.
- **Light on your Mac.** He moves with the same smooth, low-power animations as before, with fewer glow effects while he travels.

### What was new in 1.1.0

- You can type in the chat: it comes forward when you open it, and paste, copy, select all and undo work.
- The robot came to life, with the owner's 18 pose pictures, tricks and sports.
- Screen access settings: Off, Only when I ask, or Help with what's on screen.
- Drop in pictures and videos of any size.

### Install in 4 steps

1. Open the downloaded **.dmg** file.
2. Drag **Pilot Free** (or **Pilot**) onto **Applications**.
3. Open it from Applications. If your Mac says it can't check it, press **Done**.
4. Open **System Settings → Privacy & Security**, scroll down, press **Open Anyway** next to Pilot Free (or Pilot), then **Open**.

Step 4 is only needed once, because Pilot isn't signed with an Apple developer account yet. Already have an older Pilot? Quit it from the menu bar, then drag the new Pilot onto Applications and choose Replace. Pilot Free installs next to it and doesn't replace it.
