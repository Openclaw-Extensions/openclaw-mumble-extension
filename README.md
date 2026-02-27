# OpenClaw Mumble Extension

Voice conversation with OpenClaw agents via Mumble VoIP. Supports multiple agents within a single openclaw installation, each with their own room, bot username, and voice.

## Features

- Multiple agents, each in their own Mumble room with their own bot identity
- TTS and STT from openclaw's existing `messages.tts` / `tools.media.audio` config — no duplicate setup
- Per-agent voice override if you want agents to sound different in Mumble
- High-quality Opus audio (128kbps, 10ms frames)
- HTTP endpoint `POST /mumble/:agent/speak` for proactive voice announcements
- Sender allowlist per agent

## Requirements

- Mumble server
- OpenAI-compatible STT service (configured in `tools.media.audio`)
- OpenAI-compatible TTS service (configured in `messages.tts`)
- Node.js v24+ (for `@discordjs/opus` native bindings)

## Installation

```bash
git clone https://github.com/Openclaw-Extensions/openclaw-mumble-extension ~/.openclaw/extensions-src/openclaw-mumble-extension
openclaw plugins install ~/.openclaw/extensions-src/openclaw-mumble-extension
openclaw plugins enable mumble
openclaw config set plugins.entries.mumble.config.enabled true
```

## Configuration

Add to your `openclaw.json`. Each key under `agents` is an arbitrary name matching your openclaw agent session keys:

```json
{
  "plugins": {
    "entries": {
      "mumble": {
        "enabled": true,
        "config": {
          "enabled": true,
          "agents": {
            "agent-one": {
              "mumble": {
                "host": "your-mumble-server",
                "port": 64738,
                "username": "Agent-One",
                "channel": "Agent One Room"
              },
              "agent": { "sessionKey": "agent-one" },
              "tts": { "voice": "af_bella" },
              "processing": {
                "allowFrom": [],
                "silenceTimeoutMs": 500
              },
              "gateway": { "url": "http://localhost:18789" }
            },
            "agent-two": {
              "mumble": {
                "host": "your-mumble-server",
                "port": 64738,
                "username": "Agent-Two",
                "channel": "Agent Two Room"
              },
              "agent": { "sessionKey": "agent-two" },
              "tts": { "voice": "af_nova" },
              "processing": {
                "allowFrom": [],
                "silenceTimeoutMs": 500
              },
              "gateway": { "url": "http://localhost:18789" }
            }
          }
        }
      }
    }
  }
}
```

### Per-agent fields

| Field | Required | Description |
|---|---|---|
| `mumble.host` | Yes | Mumble server hostname or IP |
| `mumble.port` | No | Port (default: 64738) |
| `mumble.username` | Yes | Bot's username on Mumble |
| `mumble.password` | No | Server password |
| `mumble.channel` | No | Channel to join (empty = root) |
| `agent.sessionKey` | No | Routes voice to a specific agent session |
| `tts.voice` | No | Voice override for this agent. Falls back to global `messages.tts` voice |
| `processing.allowFrom` | No | Mumble usernames that can trigger the bot (empty = all) |
| `processing.minSpeechDurationMs` | No | Min speech duration (default: 500ms) |
| `processing.silenceTimeoutMs` | No | Silence timeout (default: 500ms) |
| `gateway.url` | No | Gateway URL (default: http://localhost:18789) |
| `gateway.token` | No | Gateway auth token |

TTS base URL, TTS model, and STT endpoint are read from openclaw's own `messages.tts` and `tools.media.audio` config — no need to repeat them here.

## HTTP Endpoint

Each agent gets its own speak endpoint:

```bash
curl -X POST http://localhost:18789/mumble/agent-one/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "Good morning everyone"}'

# Optional voice override for this request
curl -X POST http://localhost:18789/mumble/agent-two/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello", "voice": "af_nicole"}'
```

## Development

```bash
npm install
npm run build
npm run dev   # watch mode
```
