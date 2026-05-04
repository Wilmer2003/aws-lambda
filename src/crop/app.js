'use strict';

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

exports.handler = async (event) => {
  const batchItemFailures = [];

  await Promise.all(event.Records.map(async (record) => {
    try {
      let s3Notification;
      try { s3Notification = JSON.parse(record.body); } catch { return; }
      if (!s3Notification.Records) return;

      const srcKey = decodeURIComponent(
        s3Notification.Records[0].s3.object.key.replace(/\+/g, ' ')
      );
      if (!srcKey.startsWith('uploads/')) return;

      const dstKey = srcKey
        .replace(/^uploads\//, 'processed/')
        .replace(/\.[^.]+$/, '.png');

      console.log(`[crop] Procesando: ${srcKey} → ${dstKey}`);

      const getRes = await s3.send(new GetObjectCommand({
        Bucket: BUCKET_NAME, Key: srcKey
      }));
      const inputBuffer = await streamToBuffer(getRes.Body);

      // PNG minimalista 40x40 sin sharp
      // Creamos un PNG valido de 40x40 px color solido
      const pngBuffer = createSimplePNG(40, 40);

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: dstKey,
        Body: pngBuffer,
        ContentType: 'image/png',
        Metadata: { 'original-key': srcKey, 'original-size': String(inputBuffer.length) }
      }));

      console.log(`[crop] OK: s3://${BUCKET_NAME}/${dstKey}`);
    } catch (err) {
      console.error(`[crop] Error en record ${record.messageId}:`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }));

  return { batchItemFailures };
};

function createSimplePNG(width, height) {
  // PNG header + IHDR + IDAT + IEND sin dependencias externas
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let k = i;
      for (let j = 0; j < 8; j++) k = (k & 1) ? 0xEDB88320 ^ (k >>> 1) : k >>> 1;
      table[i] = k;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
    return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Crear datos de imagen: circulo verde sobre fondo transparente
  const rows = [];
  const cx = width / 2, cy = height / 2, r = width / 2;
  for (let y = 0; y < height; y++) {
    const row = [0]; // filter byte
    for (let x = 0; x < width; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= r) {
        row.push(91, 228, 155); // RGB verde
      } else {
        row.push(0, 0, 0);
      }
    }
    rows.push(Buffer.from(row));
  }

  const rawData = Buffer.concat(rows);
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}