---
title: careTalk
emoji: 🏥
colorFrom: blue
colorTo: indigo
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Digital head nurse for adult care — voice guidance & reports
---

# careTalk

**careTalk** is a browser-based digital head nurse for UK adult social care. Support workers talk (or type) to get safety reminders, guided documentation questions, and agency-ready reports — with manager/admin tools to approve users, review reports, and teach careTalk home-specific knowledge.

> Not a clinical system of record. Follow your home’s policy, escalate to the nurse in charge, and call **999** in an emergency.

---

## Live demo

**Version:** 1.0.1


- **Hugging Face Space (public):** https://huggingface.co/spaces/0001AMA/careTalk-demo  
- **Direct app URL (best for mic):** https://0001ama-caretalk-demo.static.hf.space  

Use **Chrome** or **Edge** for microphone / speech recognition. Allow mic when prompted. Prefer the **direct app URL** if the Space iframe blocks the mic. Data stays **on the device** (browser `localStorage`) unless you configure agency email/webhook forwarding.

**Default admin (first install / device reset):**

| Field | Value |
|---|---|
| Email | `admin@don.local` |
| Password / train PIN | `2473` |

---

## What careTalk does

### For support workers — **Talk to careTalk**
- Say **“Hi careTalk”** (or legacy **“Hi Don”**) to wake the assistant
- Ask for help or describe a situation: *“careTalk, Meggie just fell…”*
- Get **do / don’t** safe-practice reminders with optional visual guides
- Say **okay** when ready — careTalk asks **one documentation question at a time**, reads each answer back, and confirms before continuing
- Say **make a report** to start a **live report** that updates on your profile as you speak
- Pin quick notes for managers (“put on file”)

### For managers / nurses / admins
- **Give careTalk more knowledge** — train from the web, a single URL, or typed do/don’t guidance (PIN-protected)
- **Reports** — view support-worker reports grouped by category (falls, safeguarding, medication, etc.), training gaps, registrations, and user profiles
- Approve admin registrations; carers verify email then auto-approve as support workers

### Optional local LLM
- If [Ollama](https://ollama.com) is running locally with a chat model (default `qwen2.5:7b`), conversational replies can use the LLM; otherwise the rule-based dialogue brain is used

---

## Features at a glance

| Area | Details |
|---|---|
| Voice | UK English speech recognition + TTS; turn-taking so careTalk does not talk over you |
| Documentation | Scenario playbooks (fall, dysphagia, distress, medication, skin, wellbeing, general) |
| Reports | Pinned / live / agency outbox reports from carers **and** admins on the same device |
| Categories | Falls, safeguarding/abuse, swallowing, behaviour & distress, medication, skin, wellbeing, general |
| Training gaps | Unresolved incidents when advice is requested on an untrained topic; optional agency notify |
| PWA | Installable progressive web app (HTTPS required for mic + service worker) |
| Mobile shells | Capacitor projects for Android / iOS (`android/`, `ios/`) |

---

## Quick start (local)

**Requirements:** Node.js 20+, modern Chromium browser.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**

```bash
npm run build      # production bundle → dist/
npm run preview    # http://localhost:4173
```

### Optional Ollama (local LLM)

```bash
ollama pull qwen2.5:7b
# Ollama default: http://127.0.0.1:11434
```

---

## Default accounts & reset

- Fresh install creates **careTalk Admin** at `admin@don.local` / `2473`
- Change the train PIN after first unlock under **Give careTalk more knowledge**
- Localhost only: open `http://localhost:5173/?reset=1` to wipe device data and restore the default admin
- Admins can also use **Reports → Users → Reset all users to default admin**

---

## Modes

1. **Talk to careTalk** — carer help, voice notes, live/agency reports  
2. **Give careTalk more knowledge** — admin knowledge studio (registration role + PIN)  
3. **Reports** — outbox, gaps, regs, users (admin)

---

## Architecture (web)

```
index.html          UI shells (gate, auth, talk, train, reports)
src/main.js         App wiring, speech, Q&A flow, admin UI
src/dialogue.js     Rule-based nurse dialogue / slot filling
src/flows.js        Scenarios, wake word, session, report text
src/llm.js          Optional Ollama chat client
src/userReports.js  Live/pinned reports + presence
src/reportIndex.js  Unified carer+admin report list
src/reportCategories.js  Category grouping
src/users.js        Registration, verify, roles
src/store.js        localStorage (knowledge, agency, PIN, outbox)
src/knowledge.js    Built-in UK care practice themes
```

**Storage:** everything is **device-local** (`localStorage` / `sessionStorage`). There is no cloud care-record backend. Clearing site data clears users and reports on that browser.

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Local Vite server |
| `npm run build` | Production PWA → `dist/` |
| `npm run preview` | Preview production build |
| `npm run icons` | Regenerate icons |
| `npm run mobile:sync` | Build + Capacitor sync |
| `npm run android:open` / `ios:open` | Open native IDE |

See [DEPLOY.md](./DEPLOY.md) for website / Play Store / App Store notes.

---

## Deploy

### Hugging Face Spaces

This Space is **static** and serves a pre-built Vite `dist/` (HF free static hosting — no build credits required). Rebuild locally with `npm run build`, then publish `dist/` contents plus this README.

### Other static hosts

Deploy the `dist/` folder to Netlify, Vercel, Cloudflare Pages, S3, etc. HTTPS is required for microphone access.

### GitHub

Source: https://github.com/2000pd3rvr/careTalk

---

## Privacy & safety

- Voice and notes are processed in the browser (and optionally Ollama on localhost)
- Agency forward may open a mail client or POST to a webhook you configure
- Do not enter confidential information on shared devices without local policy approval
- careTalk supports documentation and reminders — it does **not** replace clinical assessment

---

## Licence

MIT (unless your organisation requires a different licence for distribution).
