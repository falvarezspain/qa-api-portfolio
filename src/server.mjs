import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createApi } from './api.mjs';

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/openapi.json', ['openapi.json', 'application/json; charset=utf-8']],
  ['/casos.html', ['casos.html', 'text/html; charset=utf-8']],
]);

export function createLab() {
  const api = createApi();
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const file = req.method === 'GET' && publicFiles.get(url.pathname);
      if (file) {
        const data = await readFile(new URL('../public/' + file[0], import.meta.url));
        res.writeHead(200, { 'content-type': file[1] }).end(data);
        return;
      }

      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes <= 65536) chunks.push(chunk);
      }
      const response = bytes > 65536
        ? { status: 413, body: { result: 'KO', code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo supera 64 KiB' }, headers: {} }
        : api({ method: req.method, url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      const headers = response.body === null ? response.headers :
        { 'content-type': 'application/json; charset=utf-8', ...response.headers };
      res.writeHead(response.status, headers).end(response.body === null ? undefined : JSON.stringify(response.body));
    } catch {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({
        result: 'KO', code: 'INTERNAL_ERROR', message: 'Error interno del laboratorio',
      }));
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 3000);
  createLab().listen(port, '127.0.0.1', () => console.log('Swagger UI en http://127.0.0.1:' + port));
}
