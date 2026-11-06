const auth = { authorization: 'Bearer demo-buyer' };
const json = { ...auth, 'content-type': 'application/json' };
const product = { sku: 'SKU-100', quantity: 1 };
const order = { id: 'ORD-1', ...product };
const catalog = [{ id: 'SKU-100', name: 'Teclado', stock: 5 }, { id: 'SKU-200', name: 'Ratón', stock: 0 }];

const get = (path, headers) => ({ method: 'GET', path, headers });
const post = (body = product, headers = json, path = '/api/orders') => ({ method: 'POST', path, headers, body });
const success = (status, data, headers) => ({ status, body: { result: 'OK', data }, headers });
const error = (status, code, message, headers) => ({ status, body: { result: 'KO', code, message }, headers });
const empty = (status, headers) => ({ status, headers, body: null });
const created = (data = order) => success(201, data, { location: '/api/orders/' + data.id });
const invalid = error(422, 'INVALID_ORDER', 'Se requiere SKU y una cantidad entera entre 1 y 5');
const unauthorized = error(401, 'UNAUTHORIZED', 'Token ausente o inválido', { 'www-authenticate': 'Bearer' });
const missing = error(404, 'ORDER_NOT_FOUND', 'Pedido inexistente');
const outOfStock = error(409, 'OUT_OF_STOCK', 'Stock insuficiente');
const keyed = { ...json, 'idempotency-key': 'qa-001' };

export const cases = [
  ['CAT-01', 'Estado operativo del servicio', 'Happy', true,
    [get('/api/health'), success(200, { status: 'up' })]],
  ['CAT-02', 'Catálogo con datos y ETag', 'Happy', true,
    [get('/api/products'), success(200, catalog, { etag: '"catalog-v1"' })]],
  ['CAT-03', 'Caché vigente devuelve 304 sin cuerpo', 'Happy', false,
    [get('/api/products', { 'if-none-match': '"catalog-v1"' }), empty(304, { etag: '"catalog-v1"' })]],
  ['CAT-04', 'Caché obsoleta recibe el catálogo completo', 'Happy', false,
    [get('/api/products', { 'if-none-match': '"stale"' }), success(200, catalog, { etag: '"catalog-v1"' })]],
  ['RED-01', 'Catálogo antiguo redirige de forma permanente', 'Happy', false,
    [get('/api/catalog'), empty(301, { location: '/api/products' })],
    [get('/api/products'), success(200, catalog, { etag: '"catalog-v1"' })]],
  ['RED-02', 'Promociones redirigen de forma temporal', 'Happy', false,
    [get('/api/promotions'), empty(302, { location: '/api/products' })]],
  ['RED-03', 'Checkout temporal preserva POST y cuerpo', 'Happy', false,
    [post(product, json, '/api/checkout'), empty(307, { location: '/api/orders' })],
    [{ ...post(product, json, '/api/checkout'), follow: true }, created()]],
  ['RED-04', 'Checkout legado preserva POST y cuerpo', 'Happy', false,
    [post(product, json, '/api/checkout-v1'), empty(308, { location: '/api/orders' })],
    [{ ...post(product, json, '/api/checkout-v1'), follow: true }, created()]],
  ['ORD-01', 'Crear pedido y consultarlo como propietario', 'Happy', true,
    [post(), created()], [get('/api/orders/ORD-1', auth), success(200, order)]],
  ['ORD-02', 'Aceptar cantidad máxima y consumir el stock', 'Happy', false,
    [post({ ...product, quantity: 5 }), created({ ...order, quantity: 5 })],
    [post(), outOfStock]],
  ['ORD-03', 'Reintento idempotente conserva ID y stock', 'Happy', false,
    [post(product, keyed), created()],
    [post(product, keyed), success(200, order, { 'idempotency-replayed': 'true' })],
    [post({ ...product, quantity: 4 }), created({ ...order, id: 'ORD-2', quantity: 4 })]],
  ['ORD-04', 'Clave reutilizada con otro payload produce conflicto', 'Bad', false,
    [post(product, keyed), created()],
    [post({ ...product, quantity: 2 }, keyed), error(409, 'IDEMPOTENCY_CONFLICT', 'La clave ya se usó con otro pedido')],
    [get('/api/orders/ORD-1', auth), success(200, order)]],
  ['ORD-05', 'La misma clave se puede usar con otra identidad', 'Happy', false,
    [post(product, keyed), created()],
    [post(product, { ...keyed, authorization: 'Bearer demo-other' }), created({ ...order, id: 'ORD-2' })]],
  ['ORD-06', 'El lector no puede crear pedidos', 'Bad', false,
    [post(product, { ...json, authorization: 'Bearer demo-reader' }),
      error(403, 'FORBIDDEN', 'El perfil no puede crear pedidos')]],
  ['ORD-07', 'Creación sin token', 'Bad', true,
    [post(product, { 'content-type': 'application/json' }), unauthorized]],
  ['ORD-08', 'Consulta con token inválido', 'Bad', false,
    [get('/api/orders/ORD-1', { authorization: 'Bearer invalid' }), unauthorized]],
  ['ORD-09', 'Otro usuario no puede consultar el pedido', 'Bad', false,
    [post(), created()], [get('/api/orders/ORD-1', { authorization: 'Bearer demo-other' }), missing]],
  ['ORD-10', 'Consultar un pedido inexistente', 'Bad', false,
    [get('/api/orders/ORD-999', auth), missing]],
  ['ORD-11', 'Producto inexistente', 'Bad', false,
    [post({ ...product, sku: 'SKU-999' }), error(404, 'SKU_NOT_FOUND', 'Producto inexistente')]],
  ['ORD-12', 'Producto sin stock', 'Bad', false,
    [post({ ...product, sku: 'SKU-200' }), outOfStock]],
  ['ORD-13', 'JSON malformado', 'Bad', false,
    [{ ...post(), raw: '{"sku":' }, error(400, 'INVALID_JSON', 'JSON malformado')]],
  ['ORD-14', 'Content-Type incompatible', 'Bad', false,
    [post(product, { ...auth, 'content-type': 'text/plain' }), error(415, 'UNSUPPORTED_MEDIA_TYPE', 'Se requiere application/json')]],
  ['ORD-15', 'Rechazar cuerpo superior a 64 KiB', 'Bad', false,
    [{ ...post(), oversized: true }, error(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo supera 64 KiB')]],
  ['ORD-16', 'Rechazar método no permitido', 'Bad', false,
    [get('/api/orders', auth), error(405, 'METHOD_NOT_ALLOWED', 'Método no permitido', { allow: 'POST' })]],
  ['ORD-17', 'Rechazar una ruta desconocida', 'Bad', false,
    [get('/api/unknown'), error(404, 'ROUTE_NOT_FOUND', 'Ruta inexistente')]],
  ...[
    ['18', 'Cantidad cero', { ...product, quantity: 0 }],
    ['19', 'Cantidad por encima del máximo', { ...product, quantity: 6 }],
    ['20', 'Cantidad decimal', { ...product, quantity: 1.5 }],
    ['21', 'Cantidad como texto', { ...product, quantity: '1' }],
    ['22', 'Cantidad ausente', { sku: product.sku }],
    ['23', 'SKU ausente', { quantity: 1 }],
    ['24', 'Cuerpo null', null],
    ['25', 'Cantidad negativa', { ...product, quantity: -1 }],
  ].map(([id, title, body]) => ['ORD-' + id, title, 'Bad', false, [post(body), invalid]]),
  ['RES-01', 'Error interno controlado', 'Bad', false,
    [get('/api/lab/fault?scenario=internal'), error(500, 'INTERNAL_ERROR', 'Error interno simulado')],
    [get('/api/health'), success(200, { status: 'up' })]],
  ['RES-02', 'Respuesta inválida del proveedor simulado', 'Bad', false,
    [get('/api/lab/fault?scenario=upstream'), error(502, 'BAD_GATEWAY', 'Respuesta inválida del proveedor simulado')]],
  ['RES-03', 'Indisponibilidad con Retry-After', 'Bad', false,
    [get('/api/lab/fault?scenario=unavailable'), error(503, 'SERVICE_UNAVAILABLE', 'Servicio temporalmente no disponible', { 'retry-after': '10' })]],
  ['RES-04', 'Timeout simulado del proveedor', 'Bad', false,
    [get('/api/lab/fault?scenario=timeout'), error(504, 'GATEWAY_TIMEOUT', 'Tiempo de espera del proveedor agotado')]],
  ['RES-05', 'Escenario de fallo inválido', 'Bad', false,
    [get('/api/lab/fault?scenario=unknown'), error(400, 'INVALID_SCENARIO', 'Selecciona un escenario de fallo válido')]],
  ['RES-06', 'Escenario de fallo omitido', 'Bad', false,
    [get('/api/lab/fault'), error(400, 'INVALID_SCENARIO', 'Selecciona un escenario de fallo válido')]],
];
