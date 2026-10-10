// Remove EXIF/XMP (APP1) and other metadata segments from a JPEG so uploaded
// photos don't leak the reporter's device details or home GPS position.
// Non-JPEG buffers are returned untouched.
export function stripJpegMetadata(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // malformed: leave as-is
    const marker = buf[i + 1];
    if (marker === 0xda) { // start of scan: the rest is image data
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    const len = buf.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (end > buf.length) return buf;
    // Drop APP1 (EXIF/XMP), APP2-APP15 except APP14 (Adobe colour info), and COM.
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) out.push(buf.subarray(i, end));
    i = end;
  }
  return buf;
}
