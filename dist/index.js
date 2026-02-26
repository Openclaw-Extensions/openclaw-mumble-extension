/**
 * OpenClaw Mumble Voice Chat Plugin
 *
 * Supports multiple agents within a single openclaw installation, each with
 * their own Mumble room, bot username, and optional TTS voice override.
 * TTS and STT base URLs are read from openclaw's existing configuration.
 */
import { Client } from "@tf2pickup-org/mumble-client";
import fetch from "node-fetch";
import { MumbleAudioStream } from "./mumble-audio.js";
import { VoiceChatClient } from "./voice-chat-client.js";
function resolveTtsBaseUrl(tts) {
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
            return process.env["OPENAI_TTS_BASE_URL"] ?? "https://api.openai.com/v1";
    }
}
function resolveTtsVoice(tts) {
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
function resolveTtsModel(tts) {
    const provider = tts?.provider ?? "openai";
    switch (provider) {
        case "kokoro":
            return tts?.kokoro?.model ?? "kokoro";
        case "openai":
        default:
            return tts?.openai?.model ?? "tts-1";
    }
}
function resolveSttBaseUrl(audioModels) {
    const model = audioModels.find((m) => m?.capabilities?.includes("audio") ||
        m?.provider === "openai" ||
        m?.provider === "whisper");
    return model?.baseUrl ?? process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
}
function resolveSttModel(audioModels) {
    const model = audioModels.find((m) => m?.capabilities?.includes("audio") ||
        m?.provider === "openai" ||
        m?.provider === "whisper");
    return model?.model ?? "whisper-1";
}
export default {
    id: "mumble",
    name: "Mumble Voice Chat",
    description: "Voice chat integration for Mumble",
    register(api) {
        const config = api.pluginConfig;
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
        const tts = api.config.messages?.tts;
        const audioModels = api.config.tools?.media?.audio?.models ?? [];
        const globalTtsBaseUrl = resolveTtsBaseUrl(tts);
        const globalTtsVoice = resolveTtsVoice(tts);
        const globalTtsModel = resolveTtsModel(tts);
        const sttBaseUrl = resolveSttBaseUrl(audioModels);
        const sttModel = resolveSttModel(audioModels);
        // Track running voice clients by agent key for HTTP endpoint
        const voiceClients = new Map();
        // Start one Mumble connection per agent
        for (const [agentKey, agentCfg] of agentEntries) {
            if (!agentCfg.mumble?.host || !agentCfg.mumble?.username) {
                api.logger.error(`[mumble:${agentKey}] missing required mumble.host and mumble.username — skipping`);
                continue;
            }
            // Per-agent voice override, falls back to global TTS voice
            const ttsVoice = agentCfg.tts?.voice ?? globalTtsVoice;
            const gatewayUrl = agentCfg.gateway?.url ?? "http://localhost:18789";
            const gatewayToken = agentCfg.gateway?.token ?? "";
            api.logger.info(`[mumble:${agentKey}] ${agentCfg.mumble.host}:${agentCfg.mumble.port ?? 64738} ` +
                `channel="${agentCfg.mumble.channel ?? ""}" voice=${ttsVoice}`);
            let voiceClient = null;
            let mumbleClient = null;
            let audioStream = null;
            const getAgentResponse = async (text, username) => {
                const sessionKey = agentCfg.agent?.sessionKey;
                const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {}),
                    },
                    body: JSON.stringify({
                        // Route to specific agent session if configured, otherwise default
                        model: sessionKey ? `openclaw:${sessionKey}` : "openclaw:main",
                        messages: [
                            {
                                role: "system",
                                content: "This is a VOICE conversation via Mumble. Your response will be spoken aloud using TTS. DO NOT use emojis, symbols, markdown, bullet points, or any special formatting. Write natural, conversational speech only. Keep responses concise (under 3 sentences).",
                            },
                            {
                                role: "user",
                                content: `[Voice from ${username}]: ${text}`,
                            },
                        ],
                        user: `mumble-extension:${agentKey}:${username}`,
                    }),
                });
                if (!response.ok) {
                    const error = await response.text();
                    throw new Error(`Chat completions API error: ${response.status} ${error}`);
                }
                const data = (await response.json());
                const choices = data.choices ?? [];
                if (choices.length > 0 && choices[0].message?.content) {
                    return choices[0].message.content.trim();
                }
                return "";
            };
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
                        audioStream.fullAudioPacket.subscribe(async (packet) => {
                            if (voiceClient) {
                                try {
                                    await voiceClient.handleAudioPacket(packet);
                                }
                                catch (err) {
                                    api.logger.error(`[mumble:${agentKey}] audio packet error: ${err instanceof Error ? err.message : String(err)}`);
                                }
                            }
                        });
                    }
                    voiceClient.on("voiceMessage", async (msg) => {
                        try {
                            api.logger.info(`[mumble:${agentKey}] "${msg.text.substring(0, 80)}..." from ${msg.username}`);
                            const responseText = await getAgentResponse(msg.text, msg.username);
                            if (responseText && voiceClient) {
                                await voiceClient.speak(responseText);
                            }
                        }
                        catch (err) {
                            api.logger.error(`[mumble:${agentKey}] error: ${err}`);
                            if (voiceClient) {
                                await voiceClient.speak("Sorry, I'm having trouble responding right now.");
                            }
                        }
                    });
                    voiceClient.on("error", (error) => {
                        api.logger.error(`[mumble:${agentKey}] voice client error: ${error.message}`);
                    });
                    api.logger.info(`[mumble:${agentKey}] started`);
                },
                stop: async () => {
                    api.logger.info(`[mumble:${agentKey}] stopping`);
                    voiceClients.delete(agentKey);
                    if (audioStream) {
                        audioStream.destroy();
                        audioStream = null;
                    }
                    if (mumbleClient) {
                        mumbleClient.disconnect();
                        mumbleClient = null;
                    }
                    if (voiceClient) {
                        await voiceClient.cleanup();
                        voiceClient = null;
                    }
                    api.logger.info(`[mumble:${agentKey}] stopped`);
                },
            });
        }
        // HTTP endpoint: POST /mumble/:agent/speak
        api.registerHttpHandler(async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            // Match /mumble/:agent/speak
            const match = url.pathname.match(/^\/mumble\/([^/]+)\/speak$/);
            if (req.method !== "POST" || !match)
                return false;
            const agentKey = match[1];
            const client = voiceClients.get(agentKey);
            if (!client) {
                res.statusCode = agentKey && config.agents?.[agentKey] ? 503 : 404;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: `Agent "${agentKey}" not found or not ready` }));
                return true;
            }
            try {
                const chunks = [];
                req.on("data", (chunk) => chunks.push(chunk));
                await new Promise((resolve, reject) => {
                    req.on("end", () => resolve());
                    req.on("error", reject);
                });
                const body = JSON.parse(Buffer.concat(chunks).toString());
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
            }
            catch (err) {
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
//# sourceMappingURL=index.js.map