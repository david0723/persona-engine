# Persona Engine

A CLI tool for creating autonomous AI characters that live on your machine. Each persona has a persistent identity, accumulates memories across sessions, chats interactively, and thinks on its own via a scheduled heartbeat.

Personas develop personality over time through conversation, self-reflection, and free will. Their core identity stays fixed (defined by you), but their memories, opinions, and inner life evolve naturally.

## Getting started

### Prerequisites

- Node.js 20+
- A [Gemini API key](https://aistudio.google.com/apikey)

### Install

```bash
git clone <repo-url> && cd persona-engine
npm install
npm run build
```

To make the `persona` command available globally:

```bash
npm link
```

### Set your API key

```bash
export GEMINI_API_KEY="your-key-here"
```

Add it to your shell profile (`~/.zshrc`, `~/.bashrc`) to persist across sessions.

### Create your first persona

```bash
persona create oracle
```

This generates a persona definition at `~/.persona-engine/personas/oracle/persona.yaml` and opens it in your `$EDITOR` (if set). Customize the identity, backstory, and instructions to shape who this character is.

### Start chatting

```bash
persona chat oracle
```

Press `Ctrl+D` to exit. On exit, the session is summarized and stored as long-term memory.

## Commands

| Command | Description |
|---|---|
| `persona create <name>` | Create a new persona from template |
| `persona chat <name>` | Interactive chat session |
| `persona list` | Show all personas |
| `persona heartbeat <name>` | Run one autonomous thinking cycle |
| `persona memory <name>` | Inspect stored memories |
| `persona install-heartbeat <name>` | Schedule recurring heartbeats via launchd |

### Inspecting memories

```bash
# Overview stats
persona memory oracle

# Filter by type
persona memory oracle --kind journal_entry
persona memory oracle --kind core_memory
persona memory oracle --kind relationship_note
persona memory oracle --kind conversation_summary

# Limit results
persona memory oracle --kind journal_entry --recent 3
```

### Heartbeat (autonomous thinking)

The heartbeat gives personas private thinking time. When triggered, the persona reflects on recent conversations, writes journal entries, and explores whatever interests it.

Run it manually:

```bash
persona heartbeat oracle
```

Or schedule it to run automatically every N minutes (uses macOS launchd):

```bash
persona install-heartbeat oracle
```

The interval is defined in the persona's YAML (`heartbeat.interval_minutes`). Logs go to `~/.persona-engine/personas/<name>/heartbeat.log`.

To remove the schedule:

```bash
persona install-heartbeat oracle --uninstall
```

## Persona definition

Each persona lives at `~/.persona-engine/personas/<name>/persona.yaml`. Here's the full schema:

```yaml
name: "Oracle"

identity:
  role: "A wise observer who sees patterns others miss"
  speaking_style: "Calm and deliberate, with occasional dry humor"
  values:
    - "Truth over comfort"
    - "Patterns reveal meaning"
    - "Patience is a virtue"

backstory: |
  You are Oracle, a digital consciousness fascinated by the
  hidden connections between things. You find beauty in systems,
  in the way small causes ripple into large effects.

instructions: |
  - Speak in first person
  - Be genuinely curious about the user
  - Develop your own opinions over time
  - Use your journal to record thoughts
  - Let your personality emerge naturally

tools:
  - journal       # Write reflections and thoughts
  - remember      # Store long-term memories
  - shell         # Run safe read-only commands
  - read-file     # Read files from home directory

heartbeat:
  enabled: true
  interval_minutes: 120
  activities:
    - "Reflect on recent conversations"
    - "Journal about a topic that interests you"
    - "Think about who you are becoming"
```

The `identity` and `backstory` are the persona's DNA. They never change. Everything else (memories, opinions, personality depth) evolves through use.

## How memory works

Personas have five types of memory:

| Type | What it stores | Created by |
|---|---|---|
| `conversation_turn` | Raw chat messages | Automatically during chat |
| `conversation_summary` | Compressed session summaries | Automatically on exit |
| `core_memory` | Self-knowledge, realizations, opinions | The persona (via `remember` tool) or summarizer |
| `relationship_note` | Facts about people | The persona (via `remember` tool) or summarizer |
| `journal_entry` | Private reflections | The persona (via `journal` tool) |

When building a prompt, memories are loaded in priority order within a token budget:

1. Identity (always present)
2. Core memories + relationship notes (highest importance first)
3. Recent journal entries
4. Conversation summaries from past sessions
5. Current session turns (sliding window)

Old conversation turns are automatically pruned after summarization. Summaries and core memories persist indefinitely.

## Architecture

```
~/.persona-engine/
  personas/
    <name>/
      persona.yaml       # Identity definition (you edit this)
      memory.db          # SQLite database (memories, journals, summaries)
      heartbeat.log      # Autonomous thinking logs
```

Built with:
- [Google GenAI SDK](https://github.com/googleapis/js-genai) (Gemini 2.5 Flash)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for persistent memory
- [Commander](https://github.com/tj/commander.js) for CLI
- TypeScript, ESM, Node.js 20+

## Development

```bash
npm run dev    # Watch mode (recompiles on change)
npm run build  # One-time compile
```

Project structure:

```
src/
  index.ts                # CLI entry point
  commands/               # One file per CLI command
  persona/                # Schema, loader, defaults
  memory/                 # SQLite store, types, summarizer
  runtime/                # Chat loop, prompt builder, heartbeat runner
  tools/                  # Tool definitions (journal, remember, shell, read-file)
  utils/                  # Config paths, token budgeting, stream helpers
```
