// src/upload/app.js
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Busboy = require('busboy');
const { randomUUID } = require('crypto'); // built-in Node.js 20, no dep needed

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME;

exports.handler = (event) => {
  return new Promise((resolve, reject) => {

    // ── 1. Normalizar headers ────────────────────────────────────────────────
    const rawHeaders = event.headers || {};
    const headers = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      headers[k.toLowerCase()] = v;
    }

    const contentType = headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return resolve({
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Content-Type debe ser multipart/form-data' })
      });
    }

    // ── 2. Decodificar body ──────────────────────────────────────────────────
    let bodyBuffer;
    try {
      bodyBuffer = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body || '', 'utf8');
    } catch (e) {
      return resolve({
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Body inválido', detail: e.message })
      });
    }

    // ── 3. Parsear multipart con Busboy ──────────────────────────────────────
    let bb;
    try {
      bb = Busboy({
        headers: { 'content-type': contentType },
        limits: { fileSize: 10 * 1024 * 1024 }
      });
    } catch (e) {
      return resolve({
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No se pudo inicializar el parser multipart', detail: e.message })
      });
    }

    let fileFound = false;

    bb.on('file', (fieldname, file, info) => {
      fileFound = true;
      const { filename, mimeType } = info;

      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowed.includes(mimeType)) {
        file.resume();
        return resolve({
          statusCode: 415,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: `Tipo MIME no permitido: ${mimeType}` })
        });
      }

      const extension = (filename || 'file').split('.').pop().toLowerCase();
      const key = `uploads/${randomUUID()}.${extension}`;
      const chunks = [];

      file.on('data', (chunk) => chunks.push(chunk));

      file.on('limit', () => {
        resolve({
          statusCode: 413,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Archivo supera el límite de 10 MB' })
        });
      });

      file.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          await s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
            Metadata: {
              'original-name': encodeURIComponent(filename || 'unknown'),
              'upload-time': new Date().toISOString()
            }
          }));

          console.log(`Upload OK: ${key} (${buffer.length} bytes, ${mimeType})`);

          resolve({
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'Imagen subida con éxito',
              file: key,
              bucket: BUCKET_NAME,
              size: buffer.length,
              contentType: mimeType
            })
          });
        } catch (err) {
          console.error('Error al subir a S3:', err);
          resolve({
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Error al subir a S3', detail: err.message })
          });
        }
      });
    });

    bb.on('finish', () => {
      if (!fileFound) {
        resolve({
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'No se encontró ningún archivo. Usa el campo "file".' })
        });
      }
    });

    bb.on('error', (err) => {
      console.error('Error de Busboy:', err);
      resolve({
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error al parsear multipart', detail: err.message })
      });
    });

    bb.write(bodyBuffer);
    bb.end();
  });
};