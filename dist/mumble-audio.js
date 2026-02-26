/**
 * Mumble Audio Protocol Implementation
 *
 * The @tf2pickup-org/mumble-client library has incomplete audio support.
 * This module provides the missing audio packet parsing and sending.
 */
import { Subject } from "rxjs";
/**
 * Audio codec types in Mumble protocol
 */
export var AudioCodec;
(function (AudioCodec) {
    AudioCodec[AudioCodec["CELT_Alpha"] = 0] = "CELT_Alpha";
    AudioCodec[AudioCodec["Ping"] = 1] = "Ping";
    AudioCodec[AudioCodec["Speex"] = 2] = "Speex";
    AudioCodec[AudioCodec["CELT_Beta"] = 3] = "CELT_Beta";
    AudioCodec[AudioCodec["Opus"] = 4] = "Opus";
})(AudioCodec || (AudioCodec = {}));
/**
 * Read a varint from buffer (Mumble uses protobuf-style varints)
 */
function readVarint(buffer, offset = 0) {
    let value = 0;
    let bytesRead = 0;
    let shift = 0;
    while (offset + bytesRead < buffer.length) {
        const byte = buffer[offset + bytesRead];
        value |= (byte & 0x7f) << shift;
        bytesRead++;
        if ((byte & 0x80) === 0) {
            break;
        }
        shift += 7;
    }
    return { value, bytesRead };
}
/**
 * Write a varint to buffer
 */
function writeVarint(value) {
    const bytes = [];
    while (value > 0x7f) {
        bytes.push((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    bytes.push(value & 0x7f);
    return Buffer.from(bytes);
}
/**
 * Parse a Mumble audio packet from raw UDPTunnel data
 */
export function parseAudioPacket(data) {
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
export function createAudioPacket(params) {
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
    socket;
    audioSubject = new Subject();
    sequence = 0;
    originalDecodeAudio = null;
    constructor(socket) {
        this.socket = socket;
        this.hookAudioDecoding();
    }
    /**
     * Observable of full audio packets
     */
    get fullAudioPacket() {
        return this.audioSubject.asObservable();
    }
    /**
     * Hook into the socket to intercept audio packets before they're decoded
     */
    hookAudioDecoding() {
        // Access private _audioPacket subject and raw packet handling
        // We need to intercept UDPTunnel packets before they hit decodeAudio
        // The socket uses packet observable for control messages
        // and audioPacket for decoded audio (but with missing data)
        // We'll subscribe to the raw socket and parse ourselves
        // by monkey-patching the decodeAudio method
        const socketAny = this.socket;
        if (typeof socketAny.decodeAudio === "function") {
            this.originalDecodeAudio = socketAny.decodeAudio.bind(socketAny);
            socketAny.decodeAudio = (data) => {
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
    async sendAudio(audioData, codec = AudioCodec.Opus, target = 0, isTerminator = false) {
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
    destroy() {
        this.audioSubject.complete();
        // Restore original method
        const socketAny = this.socket;
        if (this.originalDecodeAudio) {
            socketAny.decodeAudio = this.originalDecodeAudio;
        }
    }
}
//# sourceMappingURL=mumble-audio.js.map