# OpenType — open-source BYOM voice dictation (Android-first, React Native)

Wispr Flow-style dictation where **you bring your own models**: any
OpenAI-compatible transcription server plus an optional OpenAI-compatible LLM
for transcript cleanup. No vendor cloud, no account, on-device history.

## Status: MVP scaffold (v1 in progress)

- [x] Bare React Native 0.87 + Kotlin native shell
- [x] Floating bubble (`OverlayService`) + Accessibility auto-paste + clipboard fallback
- [x] Audio capture (`MediaRecorder`) + OpenAI-compatible STT client
- [x] Optional LLM enhance toggle + custom system prompt
- [ ] On-device transcription via whisper.rn (next)
- [ ] Dictionary / Snippets / per-app Styles / Command Mode (v2)
- [ ] iOS (keyboard/share extension — iOS cannot do system-wide bubbles)

## Quick start

```sh
npm install
npm start          # Metro, in one terminal
npm run android    # build + install on emulator/device
```

Run checks:

```sh
npm run typecheck
npm test
```

## Bring your own model

In the app → **Providers**:

- **STT**: Base URL + API key + model, e.g.
  - OpenAI: `https://api.openai.com/v1`, model `whisper-1`
  - Self-hosted faster-whisper (see `self-host/`): `http://<host>:9000/v1`
- **LLM enhance** (optional): any `/v1/chat/completions` server
  (OpenAI, LiteLLM, Ollama gateway), custom system prompt included.

API keys are stored in Android Keystore-backed encrypted preferences and are
only ever sent to the servers you configure.

## How dictation works

1. Grant mic → overlay → Accessibility permissions (Dictate tab).
2. Tap **Record** in-app, or **Show bubble** then tap the bubble in any app.
3. Stop → transcribe → optional LLM cleanup → auto-insert into the focused
   field, or clipboard fallback when no field is detected.

## Android permissions (why each one)

- `RECORD_AUDIO` — capture dictation.
- `SYSTEM_ALERT_WINDOW` — floating bubble over other apps.
- `BIND_ACCESSIBILITY_SERVICE` — detect the focused text field and insert text.
  Used exclusively for this; no screen scraping, no data collection.
- `FOREGROUND_SERVICE` (+ microphone type) — keep recording/bubble alive.
- `POST_NOTIFICATIONS` — foreground-service status (Android 13+).

## Self-hosting

See `self-host/docker-compose.yml` for a one-command faster-whisper server
exposing an OpenAI-compatible endpoint on `:9000`.
