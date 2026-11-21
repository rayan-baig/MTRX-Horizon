# Install Pilot on your Mac

Every **Pilot for Mac** release has two downloads:

- **Pilot-Free-…-mac.dmg**: **Pilot Free**. Free AI that runs on your Mac: no keys, nothing leaves your Mac, works offline once set up.
- **Pilot-…-mac.dmg**: **Pilot**. Uses your own AI key (OpenAI, Claude, Gemini or a compatible API), with Free mode as an option.

Both can be installed side by side.

1. Download the one you want from the latest **Pilot for Mac** release and open it.
2. Drag **Pilot Free** (or **Pilot**) onto **Applications**.
3. Open it from your Applications folder. If your Mac says it can't check it, press **Done**.
4. Open **System Settings → Privacy & Security**, scroll down, press **Open Anyway** next to it, then **Open**.

Step 4 is needed only once, because Pilot isn't signed with an Apple developer account yet. After that, Pilot opens like any other app and starts by itself when you log in (you can turn that off in Pilot's settings).

Pilot sits on top of your screen as a little robot. Click it to chat. Find it in the menu bar (the robot head) to hide it or quit.

## Set up Free mode (once)

1. **Install Ollama** (free, runs the AI on your Mac): in Pilot press the gear, then **Download Ollama (free)**. Your browser opens ollama.com. Open the download, drag Ollama to Applications, and open it once (it then lives in the menu bar).
2. **Download the brain**: back in Pilot's settings, press **Download brain**. Pilot picks one that fits your Mac's memory. Wait for the bar to reach 100% (a few GB, once). When the window says **Free mode · on your Mac**, say hi.
3. **Pictures (optional)**: press **Get Draw Things (free)**. The Mac App Store page opens in your browser; install Draw Things and open it, and let it download a model it suggests. Then in Draw Things open its settings, turn on **API Server**, choose **HTTP**, leave the port at **7860**, and keep Draw Things open. Pilot notices it by itself; ask Pilot for a picture.

Videos aren't available in Free mode: making video on a Mac isn't practical yet.
