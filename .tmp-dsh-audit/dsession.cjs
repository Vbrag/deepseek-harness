// Read a DSH session.v4.jsonl.zstd file: scan frames, decompress each, print decoded JSONL.
// Usage: node dsession.cjs <file> [--dump] [--lines N] [--grep PATTERN]
'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');
const ZSTD_MAGIC = 0xfd2fb528;

function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('bad magic at ' + offset);
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) break;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) break;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) break;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) break;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

const file = process.argv[2];
const opts = process.argv.slice(3).filter(a => !a.startsWith('--lines') && !a.startsWith('--grep'));
const li = process.argv.indexOf('--lines');
const linesLimit = li >= 0 ? parseInt(process.argv[li + 1], 10) : Infinity;
const gi = process.argv.indexOf('--grep');
const grep = gi >= 0 ? process.argv[gi + 1] : null;

const buf = fs.readFileSync(file);
let frames;
try { frames = scanFrames(buf); } catch (e) { console.error('scan error:', e.message); process.exit(2); }
let text = '';
for (const f of frames) {
  const fr = buf.subarray(f.start, f.end);
  let dec;
  try { dec = zlib.zstdDecompressSync(fr); } catch (e) { console.error('decompress frame err:', e.message); process.exit(3); }
  text += dec.toString('utf8');
}
const lines = text.split('\n').filter(l => l.trim());
process.stderr.write(`frames=${frames.length} decodedBytes=${Buffer.byteLength(text)} lines=${lines.length}\n`);
let out = lines;
if (grep) out = lines.filter(l => l.includes(grep));
if (out.length > linesLimit) out = out.slice(0, linesLimit);
for (const l of out) process.stdout.write(l + '\n');
