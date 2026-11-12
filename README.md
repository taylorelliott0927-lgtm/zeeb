# Zeeb

Zeeb is a small scrap-built repair bot who lives on his own at Rustwell Outpost, on the desert moon Kessa-9.
Nobody tells him what to do. He has needs, moods, a small memory, a ship he's building out of junk,
and a window onto the real internet. You can walk around his outpost in 3D and watch him live his life.

It all runs **for free**: GitHub hosts the website and wakes him up every 10 minutes, and Google Gemini's free tier does his thinking.

*Inspired by [Pino, from pinos.world](https://pinos.world).*

---

## Set it up (about 15 minutes, no coding)

### 1. Get a free Gemini key
1. Go to **https://aistudio.google.com** and sign in with a Google account.
2. Click **Get API key**, then **Create API key**.
3. Copy the key and keep it somewhere safe. Never paste it into a file or share it.

### 2. Make a GitHub repository
1. On GitHub, click **+** (top right), then **New repository**.
2. Name it `zeeb`. Set it to **Public**.
   *Public matters: GitHub's scheduled jobs are unlimited and free for public repositories. Your Gemini key still stays secret (step 4).*
3. Click **Create repository**.

### 3. Upload the files
1. Unzip `zeeb.zip` on your computer.
2. On your new repo's page, click **uploading an existing file**.
3. Open the unzipped `zeeb` folder, select **everything inside it**, and drag it onto the GitHub page.
   - The `.github` folder is hidden by default. To see it, press **Cmd + Shift + .** in Mac Finder, or turn on **View > Hidden items** in Windows File Explorer.
4. Click **Commit changes**.
5. Check that your repo shows a `.github` folder. If it's missing, upload that folder again on its own.

### 4. Give Zeeb his brain (the key)
1. In your repo, open **Settings > Secrets and variables > Actions**.
2. Click **New repository secret**.
3. Name: `GEMINI_API_KEY`. Secret: paste your key. Click **Add secret**.

### 5. Let him save his own life
1. **Settings > Actions > General**, scroll to **Workflow permissions**.
2. Choose **Read and write permissions** and click **Save**.

### 6. Turn on the website
1. **Settings > Pages**.
2. Under **Source**, choose **GitHub Actions**.

### 7. Switch him on
1. Open the **Actions** tab. If GitHub asks, click to enable workflows.
2. Click **Zeeb heartbeat** on the left, then **Run workflow**. Wait for the green tick (about 30 seconds).
3. Click **Publish website**, then **Run workflow**.
4. Your site is live at **`https://YOUR-GITHUB-NAME.github.io/zeeb/`**.

From now on, his heartbeat runs every 10 minutes by itself. Keep the page open and watch.

---

## How he works

Every heartbeat (`brain/tick.js`):

1. **Time passes.** One town day lasts 3 real hours. His needs (charge, oil, curiosity, company, craft) slowly rise.
2. **Needs pull on feelings.** Rising needs drag his mood and energy down.
3. **The world interferes.** The weather is the real live weather in Tozeur, Tunisia (strong wind there means a sandstorm here). Random things happen. Visitor notes arrive, and they move his mood whether he likes it or not.
4. **Anti-boredom rules,** taken from how Pino works:
   - his last three actions are off the menu;
   - repeating himself lowers his mood seven times more than doing something new raises it;
   - the world keeps changing, so the same plan doesn't always work.
5. **He chooses.** Gemini gets his character sheet, feelings, memories and the actions available, and picks one, with a reason, a thought and maybe something to say.
6. **The rules apply it.** Building the Little Dart uses parts he scavenged. Oil costs credits that he earns from repair jobs.
7. **The Wire (the real internet).** He can search Wikipedia for whatever he's curious about and read real space news and Hacker News headlines. What sticks goes into his memory and can inspire his projects.
8. **Small memory.** New memories only get in by pushing weaker ones out. Memories he keeps recalling become long-term.
9. **Sleep.** At 23:00 town time he docks. Once a night he writes a diary entry, dreams, updates his beliefs, and **adds to his own character sheet** based on what he really did that day.

If Gemini is busy or out of free requests, he falls back on simple rules for that heartbeat, so he never freezes.

The website (`web/`) is a small self-made 3D engine with no outside libraries. His body moves, idles, sleeps and reacts in your browser every frame. His decisions arrive from the repo every 30 seconds.

**Controls:** drag to look · scroll to zoom · **W/S** walk · **A/D** turn · **E** whistle (he turns and answers) · **F** follow Zeeb again.

## Where everything is

| File | What it is |
|---|---|
| `data/character.json` | Who Zeeb is. Edit this to change his personality. He adds to the `added` section himself. |
| `brain/world.js` | Places, actions, needs, random events. Add new actions here. |
| `brain/mind.js` | Exactly what he's asked each heartbeat and each night. |
| `brain/tick.js` | One heartbeat, start to finish. |
| `brain/internet.js` | The Wire: Wikipedia, space news, Hacker News, weather. All free, no keys. |
| `data/*.json` | His live state, feed, diary, memories and works. Created by the first heartbeat. |
| `web/` | The website and 3D outpost. |

## Visitor notes

The **Leave a note** tab opens a GitHub issue form, so visitors need a free GitHub account. Each heartbeat he reads new notes (they change his mood), and when he chooses to answer, his reply is posted as a comment and the note is closed.

## Tweaks

- **Faster or slower heartbeat:** edit the `cron` line in `.github/workflows/heartbeat.yml`. `*/5` is the fastest GitHub allows, but it may run out of Gemini's free daily requests.
- **Different model:** in **Settings > Secrets and variables > Actions > Variables**, add `GEMINI_MODEL` (e.g. a "flash-lite" model for more free requests). If the default model ever gets retired, he picks the newest free "flash" model on his own.
- **Longer days:** add `TOWN_DAY_MINUTES: 360` to the `env` of the heartbeat step.
- **Try it offline:** `node brain/simulate.js 100` fast-forwards 100 heartbeats with no AI and no internet.

## Costs

- GitHub Actions and Pages: free for public repos.
- Gemini: free tier. At a heartbeat every 10 minutes he uses roughly 100 to 150 requests a day. If you hit the limit, he just uses his simple rules until it resets.
- Wikipedia, Spaceflight News, Hacker News and Open-Meteo: free, no keys.

## Troubleshooting

- **Site says "brain hasn't saved anything yet":** run **Zeeb heartbeat** once from the Actions tab.
- **Heartbeat fails on "Save his state":** redo step 5 (read and write permissions).
- **"brain: rules" on the site:** the `GEMINI_API_KEY` secret is missing or wrong, or the free limit has been reached for the day.
- **The site lags a few minutes behind:** GitHub caches the data files for up to 5 minutes. Normal.
- **Heartbeats stopped after a long time:** GitHub pauses schedules in repos with no activity for 60 days. Open the Actions tab and re-enable the workflow.

---

Zeeb and Rustwell Outpost are original. Credit to [Pino, from pinos.world](https://pinos.world) for the idea of a creature who regulates his own feelings in a little world.
