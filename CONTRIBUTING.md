# Contributing to OpenType

Thanks for your interest in contributing to OpenType! This guide covers everything you need to get started.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Good First Issues](#good-first-issues)

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create a branch** from `main` for your change
4. **Make your changes** following the code style guidelines
5. **Test** your changes thoroughly
6. **Submit a pull request** with a clear description

```sh
git clone https://github.com/<your-username>/open-type.git
cd open-type
git checkout -b feature/your-feature-name
```

## Development Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >= 22.11 | Runtime |
| JDK | 17 | Android build |
| Android SDK | API 34+ | Target platform |
| Android device/emulator | Android 8+ | Testing |

### Install & Run

```sh
npm install
npm start              # Metro bundler (keep running in a separate terminal)
npm run android        # Build + install on connected device
```

### Verify Before Pushing

All three commands must pass with zero errors:

```sh
npm run typecheck      # TypeScript strict mode check
npm test               # Jest — 41 tests
npm run lint           # ESLint — 0 errors
```

### Metro Cache Issues

After changing `babel.config.js` or animation libraries, always restart Metro with cache reset:

```sh
npm start -- --reset-cache
```

## Code Style

### TypeScript

- **Strict mode** is enabled. No `any` types unless absolutely necessary.
- All async flows must handle errors with user-friendly messages.
- Use `AbortSignal` for cancellable operations.

### Design System (Calm Flow)

- **No hardcoded colors** in screen components. Always use theme tokens from `src/theme.ts`.
- Use `AppIcon` for all icons (38 available glyphs in `src/icons.tsx`). Never use icon fonts.
- Follow the motion ladder: 120ms press, 200ms fades, 320ms transitions.
- Use spring physics for natural motion (`motion.spring`, `motion.gentleSpring`).

### Component Patterns

- Every async flow follows: `idle → working → ok / failed-with-retry`
- Error messages must be human-readable, not stack traces
- Use `Banner` component for status messages (ok/warn/err/info)
- Components go in `src/ui.tsx`, screens go in `src/tabs/`

### File Organization

```
src/
├── tabs/           # Screen components (Home, History, Models, Settings)
├── onboarding/     # 5-step setup wizard
├── providers/      # STT and LLM provider logic
├── services/       # Pipeline, live dictation, fallback
├── stream/         # WebSocket drivers and session management
├── native/         # Android native bridge modules
├── store/          # Persistent settings and history
├── tasks/          # Headless dictation (overlay bubble)
├── ui.tsx          # Design system components (~50 primitives)
├── theme.ts        # Color tokens, spacing, motion
├── icons.tsx       # SVG icon system
├── types.ts        # Domain types and defaults
├── logging.ts      # In-memory log ring
├── haptics.ts      # Vibration patterns
├── net.ts          # HTTP client with retry
└── widgets.tsx     # Higher-level composed widgets
```

## Pull Request Process

### PR Title

Use a clear, descriptive title:

- `feat: add per-app dictation styles`
- `fix: resolve bubble not appearing after permission grant`
- `docs: update troubleshooting section`
- `refactor: consolidate connection state types`

### PR Description

Include:

1. **What** changed and **why**
2. **How** to test the change
3. **Screenshots** for UI changes
4. **Breaking changes** (if any)

### PR Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (41 tests)
- [ ] `npm run lint` passes (0 errors)
- [ ] Tested on a real Android device
- [ ] No hardcoded colors (theme tokens only)
- [ ] No new icons added (or added to `ICON_NAMES` constant)
- [ ] Async flows have proper idle/working/error states
- [ ] Error messages are user-friendly

### Review Process

1. Maintainer reviews within 7 days
2. Address feedback with new commits (don't force-push during review)
3. Squash merge once approved

## Reporting Issues

### Bug Reports

Include in your report:

- Device model and Android version
- App version (Settings → About)
- Provider configuration (URLs only, never API keys)
- Steps to reproduce
- Expected vs actual behavior
- Logcat snippet or exported debug log

### Feature Requests

Describe:

- The problem you're trying to solve
- Your proposed solution
- Alternatives you considered
- How it fits with the BYOM philosophy

## Good First Issues

These are great starting points for new contributors:

- **Dictionary UI** — personal word list management
- **Snippet expansion** — custom text shortcuts
- **Per-OEM battery guides** — Samsung, Xiaomi, Oppo specific steps
- **RTL audit** — right-to-left language support
- **Language chip expansion** — add more language presets
- **History export** — export dictations to file
- **Icon audit screen** — dev-only glyph verification
- **Accessibility improvements** — screen reader support for the app itself

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
