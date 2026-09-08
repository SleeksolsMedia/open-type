# Provider setup UX research — voice dictation apps

**Scope.** Three setup patterns that any BYO-STT app has to get right:
1. Cloud / HTTP API entry (OpenAI Whisper, Groq, faster-whisper, …)
2. WebSocket / live streaming entry
3. On-device model download (whisper.cpp, Apple Speech Analyzer, …)

**Targets surveyed (from publicly shipped UX):**
Wispr Flow, MacWhisper / WhisperX, Apple Voice Dictation / iOS keyboard,
Google Recorder, ChatGPT mobile voice settings, Otter.ai,
plus the open-source BYO-Whisper pattern from `whisper.cpp`,
`faster-whisper-server`, and the live WebSocket `whisper-live` server.

**Frame.** Mobile-only React Native, single dev, no backend — so every
recommendation is judged on (a) does it shrink the number of states the
app has to handle and (b) does it use platform primitives that already
exist. I close each section with what OpenType's existing
`SttEditor` / `LiveEditor` / `ModelRow` already does right and what's
worth stealing or fixing.

---

## Pattern 1 — Cloud / HTTP API entry

### What real apps do

| App | Endpoint | API key | Model | Connection state |
|---|---|---|---|---|
| **Wispr Flow** | Single "Server" field, URL only. Presets are a row of logos above. | Inline under URL. Masked by default, eye-toggle. Persisted in macOS Keychain / iOS Keychain. | Picker that appears after a successful connection test, showing whatever `/v1/models` returned. | Idle → spinning dot → green "Connected" badge with latency ("142ms"). Errors show first line of the response body, not a stack trace. |
| **MacWhisper** | Preset dropdown (OpenAI, Groq, ElevenLabs, Custom…) → URL auto-fills. Custom reveals a URL field. | Separate field, stored in Keychain. Shows a green/red dot beside the field. | "Fetch models" button → table with name, size, language. Or free text. | Per-row green/red icon; "Test" button with inline progress. |
| **OpenAI Whisper API official docs** | `curl https://api.openai.com/v1/audio/transcriptions` — model embedded in body. | Header `Authorization: Bearer sk-…`. | Pick from `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`. | n/a — it's docs. |
| **faster-whisper-server** (self-host) | Single `/v1` base URL. | Optional `Authorization: Bearer` header. | `/v1/models` returns the loaded model(s). | OpenAI-compatible — clients reuse the same UI. |
| **ChatGPT mobile** | No endpoint — hard-coded. | Sign-in with Apple / Google, key handled by them. | n/a (closed list). | n/a. |
| **Apple Voice Dictation** | None (system). | None. | None — uses on-device + iCloud fallback automatically. | A small spinning waveform = working. |
| **Otter.ai** | None (hosted). | Email/password SSO. | n/a. | "Listening…" / "Stopped" badge. |

### Three best patterns

#### 1A — Wispr Flow's "preset logos → URL → test → picker that materializes"
- **Right:** User sees the *shape* of the choice (one of three named clouds) *before* they touch a field. The model picker is a **consequence** of the connection test, not a parallel concern. Collapses three mental steps into one.
- **Wrong:** Logo row is good for 3 vendors, ugly for 8+. No "Custom URL" affordance until the user picks a logo and then a sub-menu appears — one tap too many.

#### 1B — MacWhisper's "preset dropdown that auto-fills, with URL revealed only for Custom"
- **Right:** Two tiers: presets (no typing) vs. custom (typing). Zero string-format guessing for 95% of users.
- **Wrong:** Dropdown on mobile is expensive (system modal). The "Test" button sits far from the URL field; users fill the form, scroll, find the button, scroll back to fix the typo. Poor discovery.

#### 1C — A resolved-endpoint preview line (already in OpenType's `ResolvedPreview`)
- **Right:** Shows the *exact* request the app will send — `POST https://api.openai.com/v1/audio/transcriptions`. Kills a whole class of bug ("why am I getting 404?") because the user sees their mistake before tapping test.
- **Wrong:** Greys out the resolved line in low-contrast themes — easy to miss.

### What OpenType already does right
- `ProviderSetup.PresetGrid` is the **Wispr 1A** pattern, made touch-friendly.
- `SttEditor` auto-fills `baseUrl` + `model` from the preset, exactly like MacWhisper 1B.
- `ResolvedPreview` already implements 1C — keep it.
- The "fall back to manual model field when `/v1/models` is missing" path is correct: faster-whisper-server returns 404 for that path until you opt in.

### Gaps worth fixing
- **API key UX is the weakest part.** Plain `Field secret` — no signal that the key was accepted vs. just stored. A green check next to the field after `runConnectionTest` returns ok would close the loop (Wispr does this).
- **Language is a free-text BCP-47 field.** 99% of users will type nothing or `en`. A chip row ("Auto · English · Spanish · Hindi …") with "More…" expanding to the field would help. Keep the field as the power-user escape hatch.
- **Error messages currently bubble raw text.** Wispr's pattern: show the *first line* of the response body ("401 Unauthorized — check your API key"), not a stack. `testConnection.ts` should strip down to one sentence + a "Copy details" disclosure.
- **`conn.kind` has 6 variants** (`idle | working | live | manual | manual-ok | error`). For a single-dev codebase, that's a lot of branching. Fold `manual` and `manual-ok` into a single `verified` flag on the model, and keep only `idle | working | ok | error`. Less state, fewer bugs.

---

## Pattern 2 — WebSocket / Live streaming entry

### What real apps do

| App | Endpoint | Auth | Test UX |
|---|---|---|---|
| **OpenAI Realtime API** | `wss://api.openai.com/v1/realtime` (hard-coded). | Bearer token from same OpenAI key as the chat API. | No explicit test — fail-on-first-call. |
| **Deepgram** (used by Wispr Flow for live) | `wss://api.deepgram.com/v1/listen?model=nova-3&language=en` | `Authorization: Token <key>` header. | Test opens socket, sends 200ms silence, expects `Results` event. |
| **whisper-live** (open source) | `ws://host:9090` — custom JSON protocol, not OpenAI-compatible. | Optional `Bearer` header. | Open + send `{type: "config"}`, expect `{type: "ready"}`. |
| **MacWhisper** | Same preset dropdown as cloud. | Same key field. | "Test" with a colored dot: gray=idle, blue pulsing=working, green=ok, red+last-error-line=fail. |
| **ChatGPT mobile** | Hidden — picks for you. | Apple/Google SSO. | None. |
| **Apple Dictation** | None user-facing. | n/a. | Spinning waveform = connected. |

### Three best patterns

#### 2A — Preset grid that *replaces* the URL field
- **Right:** Picking a vendor preset *implies* the WebSocket URL, protocol, auth style, and default model. There's literally one field left: the API key.
- **Wrong:** No escape hatch for self-hosted `whisper-live` until you pick "Custom" — at which point you have to type a `ws://` URL *and* know the JSON protocol. Powerful but scary.

#### 2B — A live, scrolling handshake log
- **Right:** Monospaced "console" showing `→ Connecting…`, `→ Sending handshake…`, `✓ Server ready`. When it fails, the user sees the exact step that broke. This is what `LiveEditor.pushLine` already does — keep it.
- **Wrong:** If the log lives below the test button, the user has to scroll to see the result on a phone. Put the test button **after** the log so the latest line is always adjacent to the button.

#### 2C — A "Test live connection" button that's a tappable cancel while running
- **Right:** Same button, two roles — idle = "Test", running = "Cancel (tap)". OpenType already does this. Apple's "Stop" behaves the same way during recording.
- **Wrong:** If the test takes >3 seconds, the user assumes it crashed. Show a determinate spinner + count-up ("1.2s · 2.4s …") and a soft "this can take up to 8s" hint.

### What OpenType already does right
- `LiveEditor` cleanly **separates** the WebSocket path from the upload path (different component with its own `LiveConfig`). The right modeling — live failures don't pollute upload config.
- The `describeTarget()` preview ("Full WebSocket URL the app will open") is 2B done right.
- The "if live fails, upload the recording instead" toggle (`fallbackToUpload`) is a strong pattern — makes live mode opt-in without making it scary.

### Gaps worth fixing
- **The "Custom" path for whisper-live asks for `host`, `port`, `tls`, *and* `serverUrl` all at once.** On mobile, that's four fields. Collapse to one "Server address" field that accepts `wss://…`, `host:port`, or bare host — exactly what `LiveEditor` already does for the field. **Delete the `host`/`port`/`tls` fields** in the UI unless they're used elsewhere; if they are, hide them behind "Advanced".
- **No language picker for live providers.** Deepgram and OpenAI Realtime both accept `language` in their URL params — currently a text field with no default. A segmented "Auto / English / Spanish / …" would surface it.
- **`test.kind` has 4 states.** Fine. But the *log* `lines` array is `useState<string[]>`, not ref-backed — so the user can't see what just happened after the test is over *unless* the log is mounted when the component is. Consider hoisting the last-log to the parent so a Settings screen can show "Last live handshake: 12s ago · ok".

---

## Pattern 3 — On-device model download

### What real apps do

| App | Listing | Download UX | Delete | Disk accounting |
|---|---|---|---|---|
| **Google Recorder** (Pixel) | Single model, no choice. | First-launch prompt: "Download transcription model (XX MB)". Background, resumable. | Never — model is system-managed. | n/a. |
| **Apple Dictation** | Per-language pack, downloaded by Settings → General → Keyboard → Dictation. | Settings row "English Dictation — Downloading 32%". System download manager. | "Delete Downloaded Data" — wipes all at once. | Shown in iPhone Storage. |
| **ChatGPT mobile (advanced voice)** | None — bundled. | n/a. | n/a. | n/a. |
| **MacWhisper** | Dropdown of downloaded models + "Get more models…" link to a list with size and language. | Opens a sheet with rows: name, size, language, "Download" button. Progress bar with MB counter. | Trash icon per row. | Per-row MB pill. |
| **whisper.cpp examples** (`whisper-bench`, `whisper-talk` web UI) | Plain table: model, size, quant, language, RAM. | Direct download from HuggingFace. No resume. | Manual file delete. | None. |
| **OpenType `ModelRow`** | Card per model: name, detail line, MB pill. | Tap → spinner + MB counter + Cancel. Auto-selects when finished. | Confirm sheet ("Delete X MB model?"). | MB pill on each row + sum in section header. |

### Three best patterns

#### 3A — MacWhisper's "browse-and-fetch" sheet
- **Right:** Catalog is *separate* from "active model". Browse, pick, download — and only then does the active-model chip change. Decoupling browse from bind lets the user preview 5 models without committing to 5 GB.
- **Wrong:** Two-step flow ("Download" then "Use this") is friction. OpenType's auto-select-on-finish (in `ModelRow.h.done.then`) is the better choice for a mobile-only flow.

#### 3B — Apple Dictation's "system download manager" feel
- **Right:** Downloads feel like iOS updates — deterministic progress, pause/resume on cellular, "Downloaded" badge sticks. User trusts the system.
- **Wrong:** Apple hides the file entirely. Power users can't inspect, can't share between devices, can't pin to iCloud Drive. For an OSS app, the wrong tradeoff.

#### 3C — OpenType's existing per-row card with auto-select
- **Right:** Each model is its own state machine — `checking | ready | downloading | error`. Auto-select on finish means zero extra taps. Delete is gated behind a confirm sheet ("removes N MB"). Genuinely the best of the three for a single-dev mobile app.
- **Wrong:** No "downloaded total" summary at the top — user has no idea "I've used 750 MB of 5 GB on models." Add a one-liner: `3 downloaded · 683 MB used`.

### What OpenType already does right (loudly)
- The downloader has **probe + ranged + resume + multi-mirror + watchdog + backoff** (`downloadModel` in `providers/models.ts`). For a single-dev mobile app, this is genuinely over-engineered in the *right* direction — the user taps once and it works.
- The `received * 1024 * 1024` to MB conversion in `formatMB` is correct; the file size gate (`bytes > expected * 0.95`) prevents half-files from being selected.
- Auto-select on finish (`onSelect(model.id)` inside `h.done.then`) is exactly the Wispr/Wizard-style "make the next thing obvious" pattern.

### Gaps worth fixing
- **No "Recommended" tag.** `tiny.en` is overwhelmingly what people want on a phone (75 MB, English-only, faster than `base`). Star it. Pre-select it in the default config (already true in `DEFAULT_SETTINGS`, but the UI doesn't say so).
- **No "Storage used" summary.** Section header could read: `On-device models · 217 MB downloaded`. Cheap, useful.
- **No "Delete all" affordance.** Apple has it; OpenType forces N confirm sheets. One long-press → "Remove all downloaded models" with a confirm sheet would be appreciated by anyone who's tried `small` and hated the size.
- **Language is hidden in the model id** (`tiny.en` vs `tiny`). A small chip `[EN]` / `[Multi]` would surface the tradeoff without making the user Google "what's .en".
- **Background downloads.** `downloadModel` returns a `done` promise; if the user backgrounds the app mid-download (Android), the OS may kill the JS thread. Wrapping in a headless task (you already have one for the bubble — see "headless-task entries (recorded from the bubble while the app UI was dead)" in the README) would let downloads survive a swipe-away.

---

## Cross-cutting recommendations (single-dev RN reality)

1. **State budget.** Each editor (`SttEditor`, `LiveEditor`, `ModelRow`) should have ≤ 4 connection states. Collapse `manual`/`manual-ok` into a single `verified: boolean` on the model — saves a state machine.

2. **Save-on-blur is the right mobile default.** OpenType already saves on every `onChange` of `SttConfig`/`LiveConfig` (no explicit "Save" button). Keep it. An explicit "Save" button on mobile signals "your work isn't safe" — which is worse than autosave for a config that is small and recoverable.

3. **Bottom-sheet vs full-page.** Onboarding: full-page (committed, needs room). Settings: full-page is fine for an editor this complex — bottom sheets cap around 4 fields before scrolling gets hostile. The exception: **API key entry** should be a modal sheet so the keyboard doesn't push the preset grid off-screen.

4. **One design system, one connection-state vocabulary.**
   - `idle` = grey dot, no badge
   - `working` = pulsing coral dot, "Testing… (tap to cancel)"
   - `ok` = forest-green check, "Connected · 142ms" or "Downloaded"
   - `error` = ember-red triangle, one-line message + "Details" disclosure

   Codify in a single `<ConnBadge state={...} />` component and reuse it everywhere. Right now `Banner kind="ok|err|info"` covers three of the four — a `working` variant (pulsing) is missing.

5. **Where to put the "Test" button.** Below the resolved-URL preview, *not* at the bottom of the form. Apple, Wispr, MacWhisper all do this. OpenType has it right (after the preview, before the picker), but the working state lives in a `Row` that pushes everything below it down — use a sticky inline pill instead so the form doesn't reflow.

6. **What to copy from each app, in one line each:**
   - Wispr Flow: preset logos + auto-revealed model picker after a live test.
   - MacWhisper: per-model delete with size-aware confirm sheet.
   - Apple Dictation: deterministic download progress that feels system-managed.
   - Google Recorder: zero-config "first launch downloads the right thing."
   - ChatGPT mobile: when in doubt, hide the choice from the user.
   - Otter.ai: never let a partial state block the user — "raw · LLM skipped" honesty.

7. **What to NOT copy:**
   - MacWhisper's desktop-style dropdown — bad on mobile.
   - Wispr's URL-only "Server" field with no preset hint — bad for users who don't know faster-whisper-server exists.
   - Apple's full opacity on "Delete Downloaded Data" — for an OSS app, give the user file-level control.

---

## TL;DR for OpenType

- **Cloud editor (`SttEditor`):** keep the resolved-URL preview, fold `manual`/`manual-ok` into one state, add a key-accepted badge, replace the language field with a chip row.
- **Live editor (`LiveEditor`):** delete the `host`/`port`/`tls` fields in the UI (accept them in the address field), add a language chip row, hoist the last-handshake line out so Settings can show it.
- **Model row (`ModelRow`):** add a `[EN]`/`[Multi]` chip, a `Recommended` star on `tiny.en`, a "Storage used · N MB" header, and a "Delete all" long-press menu.
- **Cross-cutting:** build a single `<ConnBadge />` with the four states above; bottom-sheet for API key entry, full-page for everything else.