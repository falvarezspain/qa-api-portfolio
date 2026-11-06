import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLab } from '../src/server.mjs';
import { cases } from '../cases.mjs';

for (const [id, title, , smoke, ...steps] of cases) {
  test((smoke ? '[SMOKE] ' : '') + id + ' · ' + title, async t => {
    const server = createLab().listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;

    for (const [request, expected] of steps) {
      const response = await fetch(base + request.path, {
        method: request.method,
        headers: request.headers,
        body: request.oversized ? 'x'.repeat(65537) : request.raw ?? JSON.stringify(request.body),
        redirect: request.follow ? 'follow' : 'manual',
        signal: AbortSignal.timeout(3000),
      });
      const label = request.method + ' ' + request.path;
      assert.equal(response.status, expected.status, label);
      for (const [name, value] of Object.entries(expected.headers ?? {})) {
        assert.equal(response.headers.get(name), value, label + ' / ' + name);
      }
      if (expected.body === null) {
        assert.equal(await response.text(), '', label);
      } else {
        assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/, label);
        assert.deepEqual(await response.json(), expected.body, label);
      }
    }
  });
}
