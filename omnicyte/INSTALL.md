# Installing Omnicyte

Omnicyte is one small app. You don't need Python or anything else.

## 1. Download it

Get the file for your computer from the latest **Omnicyte** release on GitHub, or, for a build
of the newest code, from the newest run of the **Omnicyte app** workflow (under **Actions**, then
**Artifacts** at the bottom of the run):

| Computer | File |
|---|---|
| Windows 10 or 11 | `Omnicyte.exe` |
| Mac (macOS 11 or newer, Apple silicon) | `Omnicyte-macos.zip` |
| Linux | `Omnicyte-linux.tar.gz` |
| Chrome or Edge extension | `Omnicyte-browser-extension.zip` |

## 2. Open it

**Windows.** Put `Omnicyte.exe` somewhere it can stay, such as a new `Omnicyte` folder in your
user folder, then double-click it. Windows may say *"Windows protected your PC"*, because the app
isn't signed yet. Click **More info**, then **Run anyway**. You'll only be asked once.

**Mac.** Double-click the zip to unpack it, then drag **Omnicyte** into **Applications**.
The first time, **right-click** Omnicyte and choose **Open**, then **Open** again. A plain
double-click is refused the first time, because the app isn't notarised by Apple yet. On macOS 15
or newer, if there's no Open button, go to **System Settings → Privacy & Security** and click
**Open Anyway** next to Omnicyte.

**Linux.** Unpack it with `tar -xzf Omnicyte-linux.tar.gz`, then run `./Omnicyte`.

## 3. Set it up

The first time, Omnicyte asks for:

- **Company name** and **company email domains** (like `acme.com`). Fake copies of your own
  domain are the strongest sign of a scam, so this matters most.
- **Security team's email**, if you have one. That's where **Report to security** sends reports.
- Whether to **start when you log in** (on by default) and to **check links you copy**.

Change any of it later: right-click the buddy, then **Settings…**. If your IT team rolled
Omnicyte out, they may have filled these in already, and those fields are locked.

## 4. Add the browser extension

1. Unzip `Omnicyte-browser-extension.zip` into a folder that will stay put.
2. In Chrome, go to `chrome://extensions` (in Edge, `edge://extensions`), turn on
   **Developer mode**, click **Load unpacked**, and choose that folder.
3. Right-click the buddy, choose **Pair the browser extension…**, copy the code, and paste it into
   the extension's popup (click the Omnicyte icon in the toolbar).

## Using it

- **Drag** the buddy anywhere. **Click** it for a status. **Right-click** it to check a link,
  pause for an hour, open Settings or quit.
- When it warns you, read **Why I think so**. Press **Report to security** if you have that
  button, or **Got it, thanks** if you won't open it.
- Opening Omnicyte again while it's running just makes the buddy say hello.

## Removing it

Right-click the buddy, open **Settings…**, untick **Start Omnicyte when I log in**, save, and
quit. Then delete the app and the `.omnicyte` folder in your user folder, which holds its
settings and log.

## Where things are kept

Everything stays on your computer, in the `.omnicyte` folder in your user folder:

| File | What it is |
|---|---|
| `settings.json` | Your settings |
| `events.jsonl` | What it warned about: no message text, links shown only as site names |
| `omnicyte.log` | A short technical log, useful if something goes wrong |
| `token` | The browser extension's pairing code |
