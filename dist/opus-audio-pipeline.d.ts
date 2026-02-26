/**
 * Opus Audio Pipeline for Mumble Voice Chat
 *
 * Handles encoding and decoding of Opus audio using pure WASM libraries
 * - opus-decoder: Decode Opus frames from Mumble to PCM
 * - opus-encdec: Encode PCM to Opus frames for Mumble
 */
/**
 * Audio configuration for Mumble
 */
export declare const MUMBLE_AUDIO_CONFIG: {
    readonly sampleRate: 48000;
    readonly channels: 1;
    readonly frameSize: 480;
    readonly bitRate: 128000;
};
/**
 * Opus Decoder Wrapper
 */
export declare class MumbleOpusDecoder {
    private decoder?;
    private isReady;
    initialize(): Promise<void>;
    /**
     * Decode Opus frame to PCM
     * @param opusData - Encoded Opus frame from Mumble
     * @returns Int16Array PCM data
     */
    decode(opusData: Buffer): Promise<Int16Array>;
    free(): Promise<void>;
}
/**
 * Opus Encoder Wrapper (using @discordjs/opus)
 */
export declare class MumbleOpusEncoder {
    private encoder?;
    private isReady;
    initialize(): Promise<void>;
    /**
     * Encode PCM to Opus frame
     * @param pcmData - Int16Array or Float32Array PCM data (must be exactly 960 samples for 20ms)
     * @returns Buffer with encoded Opus frame
     */
    encode(pcmData: Int16Array | Float32Array): Promise<Buffer>;
    free(): Promise<void>;
}
/**
 * Convert PCM Int16Array to WAV Buffer for Whisper STT
 * @param pcm - PCM data as Int16Array
 * @param sampleRate - Sample rate (default 48000)
 * @param channels - Number of channels (default 1)
 * @returns WAV file as Buffer
 */
export declare function pcmToWav(pcm: Int16Array, sampleRate?: number, channels?: number): Buffer;
/**
 * Accumulator for building complete audio segments from Opus frames
 */
export declare class AudioFrameAccumulator {
    private frames;
    private totalSamples;
    /**
     * Add a decoded frame to the accumulator
     */
    addFrame(pcm: Int16Array): void;
    /**
     * Get accumulated audio and reset
     */
    getAudio(): Int16Array;
    /**
     * Check if we have accumulated audio
     */
    hasAudio(): boolean;
    /**
     * Get duration in seconds
     */
    getDuration(): number;
    /**
     * Reset accumulator
     */
    reset(): void;
}
/**
 * Chunk PCM audio into 20ms frames for encoding
 * @param pcm - Full PCM audio
 * @returns Array of 20ms frames
 */
export declare function chunkAudioForEncoding(pcm: Int16Array | Float32Array): Array<Int16Array | Float32Array>;
/**
 * Sleep utility for frame timing
 */
export declare function sleep(ms: number): Promise<void>;
//# sourceMappingURL=opus-audio-pipeline.d.ts.map