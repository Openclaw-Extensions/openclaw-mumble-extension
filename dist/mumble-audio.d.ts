/**
 * Mumble Audio Protocol Implementation
 *
 * The @tf2pickup-org/mumble-client library has incomplete audio support.
 * This module provides the missing audio packet parsing and sending.
 */
import type { Client } from "@tf2pickup-org/mumble-client";
import { Observable } from "rxjs";
export type MumbleSocket = NonNullable<Client["socket"]>;
/**
 * Audio codec types in Mumble protocol
 */
export declare enum AudioCodec {
    CELT_Alpha = 0,
    Ping = 1,
    Speex = 2,
    CELT_Beta = 3,
    Opus = 4
}
/**
 * Full audio packet with decoded data
 */
export interface FullAudioPacket {
    /** Source session ID */
    source: number;
    /** Audio codec type (header >> 5) */
    codec: number;
    /** Target (header & 0x1F): 0=normal, 1-30=whisper, 31=server loopback */
    target: number;
    /** Sequence number for packet ordering */
    sequence: number;
    /** Raw Opus/codec data */
    audioData: Buffer;
    /** Is this the last packet in the sequence? */
    isTerminator: boolean;
}
/**
 * Parse a Mumble audio packet from raw UDPTunnel data
 */
export declare function parseAudioPacket(data: Buffer): FullAudioPacket | null;
/**
 * Create audio send packet for Mumble
 */
export declare function createAudioPacket(params: {
    codec: AudioCodec;
    target: number;
    sequence: number;
    audioData: Buffer;
    isTerminator: boolean;
}): Buffer;
/**
 * Audio stream wrapper for MumbleSocket
 *
 * Provides full audio packet parsing that the library lacks.
 */
export declare class MumbleAudioStream {
    private socket;
    private audioSubject;
    private sequence;
    private originalDecodeAudio;
    constructor(socket: MumbleSocket);
    /**
     * Observable of full audio packets
     */
    get fullAudioPacket(): Observable<FullAudioPacket>;
    /**
     * Hook into the socket to intercept audio packets before they're decoded
     */
    private hookAudioDecoding;
    /**
     * Send audio data to Mumble
     */
    sendAudio(audioData: Buffer, codec?: AudioCodec, target?: number, isTerminator?: boolean): Promise<void>;
    /**
     * Clean up
     */
    destroy(): void;
}
//# sourceMappingURL=mumble-audio.d.ts.map