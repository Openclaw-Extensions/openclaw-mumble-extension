/**
 * OpenClaw Mumble Voice Chat Plugin
 *
 * Supports multiple agents within a single openclaw installation, each with
 * their own Mumble room, bot username, and optional TTS voice override.
 * TTS and STT base URLs are read from openclaw's existing configuration.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Client } from "@tf2pickup-org/mumble-client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { MumbleAudioStream, type FullAudioPacket } from "./mumble-audio.js";
import { VoiceChatClient, type VoiceMessage } from "./voice-chat-client.js";

// Minimal inline types for openclaw config fields we need.
interface TtsProviderConfig {
  baseUrl?: string;
  voice?: string;
  voiceId?: string; // elevenlabs
  model?: string;
}

interface TtsConfig {
  provider?: string;
  openai?: TtsProviderConfig;
  kokoro?: TtsProviderConfig;
  chatterbox?: TtsProviderConfig;
  piper?: TtsProviderConfig;
  elevenlabs?: TtsProviderConfig;
}

interface AudioModel {
  baseUrl?: string;
  model?: string;
  capabilities?: string[];
  provider?: string;
}

// Per-agent config entry
interface AgentMumbleConfig {
  mumble: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    channel?: string;
  };
  agent?: {
    sessionKey?: string;
  };
  tts?: {
    voice?: string; // overrides global TTS voice for this agent
  };
  processing?: {
    minSpeechDurationMs?: number;
    silenceTimeoutMs?: number;
    allowFrom?: string[];
  };
}

interface MumblePluginConfig {
  enabled?: boolean;
  agents?: Record<string, AgentMumbleConfig>;
}

function resolveTtsBaseUrl(tts: TtsConfig | undefined): string {
  const provider = tts?.provider ?? "openai";
  switch (provider) {
    case "kokoro":
      return tts?.kokoro?.baseUrl ?? "http://localhost:8102";
    case "chatterbox":
      return tts?.chatterbox?.baseUrl ?? "http://localhost:4123";
    case "piper":
      return tts?.piper?.baseUrl ?? "http://localhost:8101";
    case "openai":
    default:
      return (
        tts?.openai?.baseUrl ??
        process.env["OPENAI_TTS_BASE_URL"] ??
        "https://api.openai.com/v1"
      );
  }
}

function resolveTtsVoice(tts: TtsConfig | undefined): string {
  const provider = tts?.provider ?? "openai";
  switch (provider) {
    case "kokoro":
      return tts?.kokoro?.voice ?? "af_bella";
    case "elevenlabs":
      return tts?.elevenlabs?.voiceId ?? "";
    case "chatterbox":
      return tts?.chatterbox?.voice ?? "default";
    case "piper":
      return tts?.piper?.voice ?? "";
    case "openai":
    default:
      return tts?.openai?.voice ?? "alloy";
  }
}

function resolveTtsModel(tts: TtsConfig | undefined): string {
  const provider = tts?.provider ?? "openai";
  switch (provider) {
    case "kokoro":
      return tts?.kokoro?.model ?? "kokoro";
    case "openai":
    default:
      return tts?.openai?.model ?? "tts-1";
  }
}

function resolveSttBaseUrl(audioModels: AudioModel[]): string {
  const model = audioModels.find(
    (m) =>
      m?.capabilities?.includes("audio") ||
      m?.provider === "openai" ||
      m?.provider === "whisper",
  );
  return model?.baseUrl ?? process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
}

function resolveSttModel(audioModels: AudioModel[]): string {
  const model = audioModels.find(
    (m) =>
      m?.capabilities?.includes("audio") ||
      m?.provider === "openai" ||
      m?.provider === "whisper",
  );
  return model?.model ?? "whisper-1";
}

export default {
  id: "mumble",
  name: "Mumble Voice Chat",
  description: "Voice chat integration for Mumble",

  register(api: OpenClawPluginApi) {
    const config = api.pluginConfig as MumblePluginConfig | undefined;

    if (!config?.enabled) {
      api.logger.info("[mumble] plugin disabled (set enabled: true to activate)");
      return;
    }

    const agentEntries = Object.entries(config.agents ?? {});
    if (agentEntries.length === 0) {
      api.logger.error("[mumble] no agents configured under 'agents'");
      return;
    }

    // Resolve shared TTS/STT settings from openclaw config
    const tts = (api.config as any).messages?.tts as TtsConfig | undefined;
    const audioModels: AudioModel[] =
      ((api.config as any).tools?.media?.audio?.models as AudioModel[] | undefined) ?? [];

    const globalTtsBaseUrl = resolveTtsBaseUrl(tts);
    const globalTtsVoice = resolveTtsVoice(tts);
    const globalTtsModel = resolveTtsModel(tts);
    const sttBaseUrl = resolveSttBaseUrl(audioModels);
    const sttModel = resolveSttModel(audioModels);

    // Track running voice clients by agent key for HTTP endpoint
    const voiceClients = new Map<string, VoiceChatClient>();

    // Start one Mumble connection per agent
    for (const [agentKey, agentCfg] of agentEntries) {
      if (!agentCfg.mumble?.host || !agentCfg.mumble?.username) {
        api.logger.error(
          `[mumble:${agentKey}] missing required mumble.host and mumble.username — skipping`,
        );
        continue;
      }

      // Per-agent voice override, falls back to global TTS voice
      const ttsVoice = agentCfg.tts?.voice ?? globalTtsVoice;

      api.logger.info(
        `[mumble:${agentKey}] ${agentCfg.mumble.host}:${agentCfg.mumble.port ?? 64738} ` +
          `channel="${agentCfg.mumble.channel ?? ""}" voice=${ttsVoice}`,
      );

      let voiceClient: VoiceChatClient | null = null;
      let mumbleClient: Client | null = null;
      let audioStream: MumbleAudioStream | null = null;

      api.registerService({
        id: `mumble-${agentKey}`,

        start: async () => {
          api.logger.info(`[mumble:${agentKey}] starting`);

          voiceClient = new VoiceChatClient({
            mumbleHost: agentCfg.mumble.host,
            mumblePort: agentCfg.mumble.port ?? 64738,
            mumbleUsername: agentCfg.mumble.username,
            mumblePassword: agentCfg.mumble.password,
            mumbleChannel: agentCfg.mumble.channel,
            agentSessionKey: agentCfg.agent?.sessionKey,
            ttsUrl: globalTtsBaseUrl,
            ttsVoice,
            ttsModel: globalTtsModel,
            sttUrl: sttBaseUrl,
            sttModel,
            minSpeechDurationMs: agentCfg.processing?.minSpeechDurationMs,
            silenceTimeoutMs: agentCfg.processing?.silenceTimeoutMs,
            allowFrom: agentCfg.processing?.allowFrom,
          });

          await voiceClient.initialize();
          voiceClients.set(agentKey, voiceClient);

          mumbleClient = new Client({
            host: agentCfg.mumble.host,
            port: agentCfg.mumble.port ?? 64738,
            username: agentCfg.mumble.username,
            password: agentCfg.mumble.password,
            rejectUnauthorized: false,
          });

          await mumbleClient.connect();

          if (mumbleClient.isConnected()) {
            api.logger.info(`[mumble:${agentKey}] connected to Mumble server`);

            audioStream = new MumbleAudioStream(mumbleClient.socket);
            voiceClient.setSocket(mumbleClient.socket);
            voiceClient.setAudioStream(audioStream);
            voiceClient.setUserManager(mumbleClient.users);

            audioStream.fullAudioPacket.subscribe(async (packet: FullAudioPacket) => {
              if (voiceClient) {
                try {
                  await voiceClient.handleAudioPacket(packet);
                } catch (err) {
                  api.logger.error(
                    `[mumble:${agentKey}] audio packet error: ${err instanceof Error ? err.message : String(err)}`,
                  );
                }
              }
            });
          }

          voiceClient.on("voiceMessage", async (msg: VoiceMessage) => {
            try {
              api.logger.info(`[mumble:${agentKey}] "${msg.text.substring(0, 80)}..." from ${msg.username}`);
              const responseText = await api.invokeAgent({
                message: `[Voice from ${msg.username}]: ${msg.text}`,
                sessionKey: agentCfg.agent?.sessionKey,
                systemPrompt:
                  "This is a VOICE conversation via Mumble. DO NOT use emojis, symbols, markdown, or formatting. Write natural speech only. Keep responses under 3 sentences.",
              });
              if (responseText && voiceClient) {
                await voiceClient.speak(responseText);
              }
            } catch (err) {
              api.logger.error(`[mumble:${agentKey}] error: ${err}`);
              if (voiceClient) {
                await voiceClient.speak("Sorry, I'm having trouble responding right now.");
              }
            }
          });

          voiceClient.on("error", (error: Error) => {
            api.logger.error(`[mumble:${agentKey}] voice client error: ${error.message}`);
          });

          api.logger.info(`[mumble:${agentKey}] started`);
        },

        stop: async () => {
          api.logger.info(`[mumble:${agentKey}] stopping`);
          voiceClients.delete(agentKey);

          if (audioStream) { audioStream.destroy(); audioStream = null; }
          if (mumbleClient) { mumbleClient.disconnect(); mumbleClient = null; }
          if (voiceClient) { await voiceClient.cleanup(); voiceClient = null; }

          api.logger.info(`[mumble:${agentKey}] stopped`);
        },
      });
    }

    // HTTP endpoint: POST /mumble/:agent/speak
    api.registerHttpHandler(async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
      const url = new URL(req.url ?? "/", "http://localhost");

      // Match /mumble/:agent/speak
      const match = url.pathname.match(/^\/mumble\/([^/]+)\/speak$/);
      if (req.method !== "POST" || !match) return false;

      const agentKey = match[1];
      const client = voiceClients.get(agentKey!);

      if (!client) {
        res.statusCode = agentKey && config.agents?.[agentKey] ? 503 : 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: `Agent "${agentKey}" not found or not ready` }));
        return true;
      }

      try {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        await new Promise<void>((resolve, reject) => {
          req.on("end", () => resolve());
          req.on("error", reject);
        });

        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          text?: string;
          voice?: string;
        };

        if (!body.text) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing required field: text" }));
          return true;
        }

        await client.speak(body.text, body.voice);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: true }));
        return true;
      } catch (err) {
        api.logger.error(`[mumble:${agentKey}] speak error: ${err}`);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: String(err) }));
        return true;
      }
    });

    api.logger.info(`[mumble] registered ${agentEntries.length} agent(s)`);
    api.logger.info("[mumble] HTTP endpoint: POST /mumble/:agent/speak");
  },
};
