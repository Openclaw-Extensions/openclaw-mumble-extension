/**
 * Variable-length integer decoding for Mumble protocol
 * Based on @tf2pickup-org/mumble-client implementation
 */
export interface VarintResult {
    value: number;
    length: number;
}
/**
 * Read varint from buffer
 * Returns { value, length } where length is bytes consumed
 */
export declare function readVarint(buffer: Buffer): VarintResult;
//# sourceMappingURL=varint-reader.d.ts.map