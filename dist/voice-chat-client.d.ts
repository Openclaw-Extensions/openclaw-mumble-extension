/**
 * Mumble Voice Chat Client
 *
 * Handles full voice conversation loop:
 * 1. Receive Opus audio from Mumble
 * 2. Decode to PCM and convert to WAV
 * 3. Transcribe with Whisper STT
 * 4. Send text to voice-chat agent
 * 5. Get response and convert to speech with Kokoro TTS
 * 6. Encode to Opus and send back to Mumble
 */
import { EventEmitter } from "node:events";
import { type FullAudioPacket, type MumbleSocket, type MumbleAudioStream } from "./mumble-audio.js";
export interface VoiceChatConfig {
    mumbleHost: string;
    mumblePort: number;
    mumbleUsername: string;
    mumblePassword?: string;
    mumbleChannel?: string;
    agentSessionKey?: string;
    sttUrl: string;
    sttModel: string;
    ttsUrl: string;
    ttsVoice: string;
    ttsModel: string;
    minSpeechDurationMs?: number;
    silenceTimeoutMs?: number;
    allowFrom?: string[];
}
export interface VoiceMessage {
    userId: number;
    username: string;
    text: string;
    durationMs: number;
}
export declare class VoiceChatClient extends EventEmitter {
    private config;
    private decoder;
    private encoder;
    private socket?;
    private audioStream?;
    private userManager?;
    private userAudio;
    private silenceTimers;
    private isInitialized;
    constructor(config: VoiceChatConfig);
    initialize(): Promise<void>;
    /**
     * Set the Mumble socket for sending audio
     */
    setSocket(socket: MumbleSocket): void;
    /**
     * Set the audio stream wrapper for sending audio
     */
    setAudioStream(audioStream: MumbleAudioStream): void;
    /**
     * Set the Mumble user manager for username lookups
     */
    setUserManager(userManager: any): void;
    /**
     * Handle incoming audio packet from Mumble
     */
    handleAudioPacket(packet: FullAudioPacket): Promise<void>;
    /**
     * Process accumulated speech from a user
     */
    private processSpeech;
    /**
     * Transcribe audio using Whisper STT
     */
    private transcribeAudio;
    /**
     * Handle agent response and speak it back
     */
    private handleAgentResponse;
    /**
     * Get response from voice-chat agent
     * TODO: Integrate with OpenClaw's sessions_send
     */
    private getAgentResponse;
    /**
     * Sanitize text for voice output (removes markdown, emojis, formatting)
     */
    private sanitizeForVoice;
    /**
     * Convert text to speech and send to Mumble
     * @param text Text to speak
     * @param voice Optional voice override (uses config default if not provided)
     */
    speak(text: string, voice?: string): Promise<void>;
    /**
     * Send audio frames to Mumble
     */
    private sendAudioFrames;
    /**
     * Resample audio from 24kHz to 48kHz (simple linear interpolation)
     */
    private resample24to48;
    /**
     * Clean up resources
     */
    cleanup(): Promise<void>;
}
//# sourceMappingURL=voice-chat-client.d.ts.map