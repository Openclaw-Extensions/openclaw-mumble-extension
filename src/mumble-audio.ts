/**
 * Mumble Audio Protocol Implementation
 *
 * The @tf2pickup-org/mumble-client library has incomplete audio support.
 * This module provides the missing audio packet parsing and sending.
 */

import type { Client } from "@tf2pickup-org/mumble-client";
import { Observable, Subject } from "rxjs";

// Type alias for the socket from the client
export type MumbleSocket = NonNullable<Client["socket"]>;

/**
 * Audio codec types in Mumble protocol
 */
export enum AudioCodec {
  CELT_Alpha = 0,
  Ping = 1,
  Speex = 2,
  CELT_Beta = 3,
  Opus = 4,
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
 * Read a Mumble varint from buffer.
 * Mumble uses its own big-endian varint format (not protobuf/LEB128).
 */
function readVarint(buffer: Buffer, offset: number = 0): { value: number; bytesRead: number } {
  const sub = buffer.subarray(offset);
  if (sub.length === 0) return { value: 0, bytesRead: 0 };

  const b0 = sub[0];

  if ((b0 & 0x80) === 0) {
    return { value: b0, bytesRead: 1 };
  } else if ((b0 & 0xc0) === 0x80) {
    return { value: ((b0 & 0x3f) << 8) | sub[1], bytesRead: 2 };
  } else if ((b0 & 0xe0) === 0xc0) {
    return { value: ((b0 & 0x1f) << 16) | (sub[1] << 8) | sub[2], bytesRead: 3 };
  } else if ((b0 & 0xf0) === 0xe0) {
    return {
      value: ((b0 & 0x0f) << 24) | (sub[1] << 16) | (sub[2] << 8) | sub[3],
      bytesRead: 4,
    };
  } else if ((b0 & 0xfc) === 0xf0) {
    return { value: sub.readUInt32BE(1), bytesRead: 5 };
  }

  return { value: 0, bytesRead: 1 };
}

/**
 * Write a Mumble varint to buffer.
 * Mumble uses its own big-endian varint format (not protobuf/LEB128).
 */
function writeVarint(value: number): Buffer {
  if (value < 0x80) {
    return Buffer.from([value]);
  } else if (value < 0x4000) {
    return Buffer.from([0x80 | (value >> 8), value & 0xff]);
  } else if (value < 0x200000) {
    return Buffer.from([0xc0 | (value >> 16), (value >> 8) & 0xff, value & 0xff]);
  } else if (value < 0x10000000) {
    return Buffer.from([
      0xe0 | (value >> 24),
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    ]);
  } else {
    const buf = Buffer.alloc(5);
    buf[0] = 0xf0;
    buf.writeUInt32BE(value, 1);
    return buf;
  }
}

/**
 * Parse a Mumble audio packet from raw UDPTunnel data
 */
export function parseAudioPacket(data: Buffer): FullAudioPacket | null {
  if (data.length < 1) {
    return null;
  }

  const header = data[0];
  const codec = (header >> 5) & 0x07;
  const target = header & 0x1f;

  // Read session ID (varint)
  const session = readVarint(data, 1);
  let offset = 1 + session.bytesRead;

  // Read sequence number (varint)
  const sequence = readVarint(data, offset);
  offset += sequence.bytesRead;

  // Rest is audio data
  // For Opus, first varint is length, then data
  if (codec === AudioCodec.Opus) {
    const opusHeader = readVarint(data, offset);
    offset += opusHeader.bytesRead;

    // Check terminator bit (highest bit of length)
    const isTerminator = (opusHeader.value & 0x2000) !== 0;
    const audioLength = opusHeader.value & 0x1fff;

    if (offset + audioLength > data.length) {
      return null; // Incomplete packet
    }

    const audioData = data.subarray(offset, offset + audioLength);

    return {
      source: session.value,
      codec,
      target,
      sequence: sequence.value,
      audioData: Buffer.from(audioData),
      isTerminator,
    };
  }

  // For other codecs, just grab remaining data
  return {
    source: session.value,
    codec,
    target,
    sequence: sequence.value,
    audioData: Buffer.from(data.subarray(offset)),
    isTerminator: false,
  };
}

/**
 * Create audio send packet for Mumble
 */
export function createAudioPacket(params: {
  codec: AudioCodec;
  target: number;
  sequence: number;
  audioData: Buffer;
  isTerminator: boolean;
}): Buffer {
  const header = ((params.codec & 0x07) << 5) | (params.target & 0x1f);
  const sequenceVarint = writeVarint(params.sequence);

  if (params.codec === AudioCodec.Opus) {
    // Opus: length varint with terminator bit
    let lengthValue = params.audioData.length & 0x1fff;
    if (params.isTerminator) {
      lengthValue |= 0x2000;
    }
    const lengthVarint = writeVarint(lengthValue);

    return Buffer.concat([Buffer.from([header]), sequenceVarint, lengthVarint, params.audioData]);
  }

  // Other codecs: just append data
  return Buffer.concat([Buffer.from([header]), sequenceVarint, params.audioData]);
}

/**
 * Audio stream wrapper for MumbleSocket
 *
 * Provides full audio packet parsing that the library lacks.
 */
export class MumbleAudioStream {
  private socket: MumbleSocket;
  private audioSubject = new Subject<FullAudioPacket>();
  private sequence = 0;
  private originalDecodeAudio: ((data: Buffer) => void) | null = null;

  constructor(socket: MumbleSocket) {
    this.socket = socket;
    this.hookAudioDecoding();
  }

  /**
   * Observable of full audio packets
   */
  get fullAudioPacket(): Observable<FullAudioPacket> {
    return this.audioSubject.asObservable();
  }

  /**
   * Hook into the socket to intercept audio packets before they're decoded
   */
  private hookAudioDecoding(): void {
    // Access private _audioPacket subject and raw packet handling
    // We need to intercept UDPTunnel packets before they hit decodeAudio

    // The socket uses packet observable for control messages
    // and audioPacket for decoded audio (but with missing data)

    // We'll subscribe to the raw socket and parse ourselves
    // by monkey-patching the decodeAudio method

    const socketAny = this.socket as any;

    if (typeof socketAny.decodeAudio === "function") {
      this.originalDecodeAudio = socketAny.decodeAudio.bind(socketAny);

      socketAny.decodeAudio = (data: Buffer) => {
        // Parse full audio packet
        const packet = parseAudioPacket(data);
        if (packet) {
          this.audioSubject.next(packet);
        }

        // Still call original for basic audioPacket observable
        if (this.originalDecodeAudio) {
          this.originalDecodeAudio(data);
        }
      };
    }
  }

  /**
   * Send audio data to Mumble
   */
  async sendAudio(
    audioData: Buffer,
    codec: AudioCodec = AudioCodec.Opus,
    target: number = 0,
    isTerminator: boolean = false,
  ): Promise<void> {
    const packet = createAudioPacket({
      codec,
      target,
      sequence: this.sequence++,
      audioData,
      isTerminator,
    });

    // UDPTunnel packet type is 1
    const prefix = Buffer.alloc(6);
    prefix.writeUInt16BE(1, 0); // Type: UDPTunnel
    prefix.writeUInt32BE(packet.length, 2); // Length

    await this.socket.write(Buffer.concat([prefix, packet]));
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.audioSubject.complete();

    // Restore original method
    const socketAny = this.socket as any;
    if (this.originalDecodeAudio) {
      socketAny.decodeAudio = this.originalDecodeAudio;
    }
  }
}
