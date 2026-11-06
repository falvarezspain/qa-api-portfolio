import { readFile, writeFile } from 'node:fs/promises';
import { cases } from '../cases.mjs';

const string = { type: 'string' };
const quantity = { type: 'integer', minimum: 1, maximum: 5 };
const cents = { type: 'integer', minimum: 0 };
const coupon = { type: 'string', description: 'DEMO10 aplica 10 % desde un subtotal de 90 EUR.' };
const orderInput = { type: 'object', required: ['sku', 'quantity'], properties: { sku: string, quantity, coupon } };
const orderId = { in: 'path', name: 'id', required: true, schema: string, example: 'ORD-1' };
const header = (name, description, example) => ({ in: 'header', name, description, schema: string, example });
const orderBody = {
  required: true,
  content: { 'application/json': { schema: orderInput, examples: {
    valid: { summary: 'Pedido válido', value: { sku: 'SKU-100', quantity: 1 } },
    discountWithShipping: { summary: 'Cupón válido y envío con cargo', value: { sku: 'SKU-100', quantity: 2, coupon: 'DEMO10' } },
    discountFreeShipping: { summary: 'Cupón válido y envío gratis', value: { sku: 'SKU-100', quantity: 3, coupon: 'DEMO10' } },
    belowCouponMinimum: { summary: 'Subtotal inferior al mínimo del cupón', value: { sku: 'SKU-100', quantity: 1, coupon: 'DEMO10' } },
    noStock: { summary: 'Producto sin stock', value: { sku: 'SKU-200', quantity: 1 } },
    invalid: { summary: 'Cantidad fuera de rango', value: { sku: 'SKU-100', quantity: 0 } },
    malformed: { summary: 'JSON malformado', value: '{"sku":' },
  } } },
};
const auth = [{ DemoBearer: [] }];
const operations = [
  ['/api/health', 'get', 'Catálogo', 'Comprobar estado operativo'],
  ['/api/products', 'get', 'Catálogo', 'Consultar catálogo y caché', {
    parameters: [header('If-None-Match', 'Envíalo para validar el snapshot del catálogo.', '"catalog-v1"')],
  }],
  ['/api/catalog', 'get', 'Redirecciones', 'Consultar el catálogo por su ruta anterior'],
  ['/api/promotions', 'get', 'Redirecciones', 'Consultar la ruta temporal de promociones'],
  ['/api/checkout', 'post', 'Redirecciones', 'Redirigir checkout temporal', { security: auth, requestBody: orderBody }],
  ['/api/checkout-v1', 'post', 'Redirecciones', 'Redirigir checkout legado', { security: auth, requestBody: orderBody }],
  ['/api/orders', 'post', 'Pedidos', 'Crear un pedido o repetirlo con la misma clave', {
    security: auth, requestBody: orderBody,
    description: 'El teclado cuesta 45 EUR y el ratón cuesta 20 EUR. DEMO10 descuenta 10 % desde 90 EUR de subtotal y solo puede estar aplicado a un pedido confirmado por comprador. El envío cuesta 7 EUR y es gratis desde 90 EUR después del descuento.',
    parameters: [header('Idempotency-Key', 'La misma identidad, SKU, cantidad y cupón recuperan el pedido en su estado actual.', 'qa-001')],
  }],
  ['/api/orders/{id}', 'get', 'Pedidos', 'Consultar un pedido como propietario', {
    security: auth,
    parameters: [orderId],
  }],
  ['/api/orders/{id}/cancel', 'post', 'Pedidos', 'Cancelar un pedido y liberar su reserva', {
    security: auth, parameters: [orderId],
    description: 'Solo el propietario puede cancelar. La primera cancelación devuelve el stock y libera el cupón. Las siguientes devuelven el mismo pedido cancelado.',
  }],
  ['/api/lab/fault', 'get', 'Resiliencia', 'Simular un fallo controlado', {
    parameters: [{ in: 'query', name: 'scenario', required: true, schema: string, examples: {
      internal: { value: 'internal' }, upstream: { value: 'upstream' },
      unavailable: { value: 'unavailable' }, timeout: { value: 'timeout' }, invalid: { value: 'unknown' },
    } }],
  }],
];
const descriptions = {
  200: 'Operación exitosa', 201: 'Pedido creado', 301: 'Redirección permanente',
  302: 'Redirección temporal', 304: 'Snapshot sin cambios', 307: 'Redirección temporal con el mismo método',
  308: 'Redirección permanente con el mismo método', 400: 'Solicitud inválida',
  401: 'Token ausente o inválido', 403: 'Permiso insuficiente', 404: 'Recurso inexistente',
  409: 'Conflicto', 413: 'Cuerpo demasiado grande', 415: 'Formato incompatible',
  422: 'Datos inválidos', 500: 'Error interno simulado', 502: 'Respuesta inválida del proveedor',
  503: 'Servicio temporalmente no disponible', 504: 'Tiempo de espera agotado',
};
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'QA API Portfolio · Tienda demo', version: '1.1.0',
    description: 'Laboratorio de pruebas black-box. [Ver matriz y pasos](./casos.html). Usa **Authorize** e ingresa `demo-buyer` para crear pedidos, `demo-reader` para probar permisos o `demo-other` para verificar aislamiento. Reinicia el servidor para recuperar el stock inicial. El navegador puede seguir las redirecciones automáticamente.',
  },
  servers: [{ url: '.' }],
  paths: {},
  components: {
    securitySchemes: { DemoBearer: { type: 'http', scheme: 'bearer', description: 'Token ficticio del laboratorio' } },
    schemas: {
      Error: { type: 'object', required: ['result', 'code', 'message'], properties: {
        result: { type: 'string', enum: ['KO'] }, code: string, message: string,
      } },
      Order: { type: 'object', required: ['id', 'sku', 'quantity', 'status', 'pricing'], properties: {
        id: string, sku: string, quantity, coupon,
        status: { type: 'string', enum: ['CONFIRMED', 'CANCELLED'] },
        pricing: { $ref: '#/components/schemas/Pricing' },
      } },
      Pricing: { type: 'object', description: 'Importes en céntimos de euro.',
        required: ['currency', 'subtotalCents', 'discountCents', 'shippingCents', 'totalCents'],
        properties: {
          currency: { type: 'string', enum: ['EUR'] }, subtotalCents: cents, discountCents: cents,
          shippingCents: cents, totalCents: cents,
        },
      },
      Product: { type: 'object', required: ['id', 'name', 'stock'], properties: {
        id: string, name: string, stock: { type: 'integer', minimum: 0 },
      } },
    },
  },
};

for (const [path, method, tag, summary, options] of operations) {
  const responses = {};
  const links = new Set();
  for (const [id, title, , , ...steps] of cases) {
    steps.forEach(([request, expected], index) => {
      const route = request.path.split('?')[0].replace(/\/ORD-\d+(?=\/|$)/, '/{id}');
      if (request.method.toLowerCase() !== method || route !== path) return;
      links.add(id);
      if (request.follow) return;
      const response = responses[expected.status] ??= { description: descriptions[expected.status] };
      for (const [key, value] of Object.entries(expected.headers ?? {})) {
        response.headers ??= {};
        response.headers[key] ??= { schema: string, example: value };
      }
      if (expected.body === null) return;
      const data = path === '/api/products'
        ? { type: 'array', items: { $ref: '#/components/schemas/Product' } }
        : path === '/api/health'
          ? { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['up'] } } }
          : { $ref: '#/components/schemas/Order' };
      response.content ??= { 'application/json': {
        schema: expected.body.result === 'KO' ? { $ref: '#/components/schemas/Error' } : {
          type: 'object', required: ['result', 'data'], properties: { result: { type: 'string', enum: ['OK'] }, data },
        },
        examples: {},
      } };
      response.content['application/json'].examples[id + '-' + (index + 1)] = {
        summary: id + ' · ' + title, value: expected.body,
      };
    });
  }
  spec.paths[path] ??= {};
  spec.paths[path][method] = {
    tags: [tag], summary, ...options,
    description: [options?.description, 'Casos: ' + [...links].map(id => '[' + id + '](./casos.html#' + id + ')').join(' · ')]
      .filter(Boolean).join('\n\n'),
    responses,
  };
}

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const details = (request, expected) => {
  const body = request.oversized ? 'Texto de 65537 bytes' : request.raw ?? JSON.stringify(request.body);
  const requestLines = [request.method + ' ' + request.path, ...Object.entries(request.headers ?? {}).map(([key, value]) => key + ': ' + value)];
  if (body !== undefined) requestLines.push('', body);
  if (request.follow) requestLines.push('', 'Cliente HTTP con seguimiento de redirección');
  const expectedLines = ['HTTP ' + expected.status, ...Object.entries(expected.headers ?? {}).map(([key, value]) => key + ': ' + value), '',
    expected.body === null ? '(sin cuerpo)' : JSON.stringify(expected.body, null, 2)];
  return '<pre>' + esc(requestLines.join('\n') + '\n\n→\n\n' + expectedLines.join('\n')) + '</pre>';
};
const rows = cases.map(([id, title, kind, smoke, ...steps]) =>
  '<tr id="' + id + '"><th scope="row">' + id + '</th><td>' + kind + '</td><td>' +
  (smoke ? 'Smoke y regresión' : 'Regresión') + '</td><td><details><summary>' + esc(title) +
  ' <strong>(' + steps.map(([, expected]) => expected.status).join(' → ') + ')</strong></summary>' +
  steps.map(([request, expected]) => details(request, expected)).join('') + '</details></td></tr>').join('\n');

const html = `<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Matriz de pruebas · QA API Portfolio</title>
<style>
body{font:1rem system-ui,sans-serif;max-width:74rem;margin:auto;padding:1.5rem;color:#152638;background:#f4f8fc}
a{color:#095bb5} table{width:100%;border-collapse:collapse;background:white} th,td{text-align:left;padding:.75rem;border-bottom:1px solid #d5e0eb}
thead{background:#142c46;color:white} pre{background:#edf4fa;padding:1rem;white-space:pre-wrap;overflow-wrap:anywhere}
summary{cursor:pointer} tr:target{outline:2px solid #095bb5;background:#eaf4ff} .table{overflow-x:auto}
</style>
<nav><a href="./">Swagger UI</a> · <a href="./openapi.json">OpenAPI JSON</a></nav>
<main><h1>Matriz de pruebas de API</h1>
<p>${cases.length} casos black-box, ${cases.filter(item => item[3]).length} de smoke. Abre un caso para ver la solicitud y la respuesta esperada.</p>
<p>Cada caso automatizado parte del stock inicial y un servidor vacío. En una prueba manual, reinicia el laboratorio entre casos que modifiquen stock. Los casos de rutas o métodos inexistentes se ejecutan desde la suite HTTP.</p>
<div class="table"><table><thead><tr><th>ID</th><th>Flujo</th><th>Suite</th><th>Caso y pasos</th></tr></thead><tbody>
${rows}
</tbody></table></div></main>
<script>function focusCase(){const row=document.getElementById(location.hash.slice(1));if(row)row.querySelector('details').open=true}addEventListener('hashchange',focusCase);focusCase()</script>
</html>`;

for (const [name, content] of [['openapi.json', JSON.stringify(spec, null, 2)], ['casos.html', html]]) {
  const file = new URL('../public/' + name, import.meta.url);
  const output = content + '\n';
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')).replaceAll('\r\n', '\n') !== output) {
      throw new Error(name + ' está desactualizado. Ejecuta npm run docs.');
    }
  } else await writeFile(file, output);
}
