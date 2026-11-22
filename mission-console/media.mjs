import { open } from 'node:fs/promises';
import { extname } from 'node:path';

export const mediaTypes = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export const documentTypes = {
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

export async function sendMedia(request, response, artifact) {
  let file;
  try {
    file = await open(artifact.path, 'r');
    const { size, mtimeMs } = await file.stat();
    if (size !== artifact.size || mtimeMs !== artifact.mtimeMs) {
      response.writeHead(409).end('The evidence file changed. Register the new capture.');
      return;
    }
    let start = 0;
    let end = size - 1;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        response.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
        return;
      }
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else start = Number(match[1]);
      if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        response.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
        return;
      }
    }
    response.writeHead(range ? 206 : 200, {
      'Content-Type': mediaTypes[extname(artifact.path).toLowerCase()] ?? documentTypes[extname(artifact.path).toLowerCase()],
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size } : {}),
    });
    const stream = file.createReadStream({ start, end, autoClose: true });
    file = undefined;
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch {
    if (!response.headersSent) response.writeHead(404).end('Evidence file unavailable.');
    else response.destroy();
  } finally {
    await file?.close();
  }
}
