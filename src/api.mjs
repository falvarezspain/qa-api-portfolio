const products = [
  { id: 'SKU-100', name: 'Teclado', stock: 5 },
  { id: 'SKU-200', name: 'Ratón', stock: 0 },
];
const unitPrices = new Map([['SKU-100', 4500], ['SKU-200', 2000]]);
const freeShippingMinimum = 9000;
const couponCode = 'DEMO10';

const reply = (status, body, headers = {}) => ({ status, body, headers });
const ok = (status, data, headers) => reply(status, { result: 'OK', data }, headers);
const ko = (status, code, message, headers) =>
  reply(status, { result: 'KO', code, message }, headers);

const faults = {
  internal: [500, 'INTERNAL_ERROR', 'Error interno simulado'],
  upstream: [502, 'BAD_GATEWAY', 'Respuesta inválida del proveedor simulado'],
  unavailable: [503, 'SERVICE_UNAVAILABLE', 'Servicio temporalmente no disponible', { 'retry-after': '10' }],
  timeout: [504, 'GATEWAY_TIMEOUT', 'Tiempo de espera del proveedor agotado'],
};

export function createApi() {
  const orders = new Map();
  const keys = new Map();
  const redeemedCoupons = new Set();
  const stock = new Map(products.map(product => [product.id, product.stock]));

  return ({ method, url, headers, body }) => {
    const path = url.pathname;
    if (method === 'GET' && path === '/api/health') return ok(200, { status: 'up' });
    if (method === 'GET' && path === '/api/products') {
      const etag = '"catalog-v1"';
      if (headers['if-none-match'] === etag) return reply(304, null, { etag });
      // El catálogo representa un snapshot inicial. El stock operativo se valida al comprar.
      return ok(200, products, { etag });
    }
    if (method === 'GET' && path === '/api/catalog') return reply(301, null, { location: '/api/products' });
    if (method === 'GET' && path === '/api/promotions') return reply(302, null, { location: '/api/products' });
    if (method === 'POST' && path === '/api/checkout') return reply(307, null, { location: '/api/orders' });
    if (method === 'POST' && path === '/api/checkout-v1') return reply(308, null, { location: '/api/orders' });
    if (method === 'GET' && path === '/api/lab/fault') {
      const fault = url.searchParams.get('scenario');
      if (!Object.hasOwn(faults, fault)) return ko(400, 'INVALID_SCENARIO', 'Selecciona un escenario de fallo válido');
      return ko(...faults[fault]);
    }

    const orderMatch = /^\/api\/orders\/(ORD-\d+)(\/cancel)?$/.exec(path);
    if (path !== '/api/orders' && !orderMatch) return ko(404, 'ROUTE_NOT_FOUND', 'Ruta inexistente');
    const cancel = orderMatch?.[2];
    const allowed = orderMatch && !cancel ? 'GET' : 'POST';
    if (method !== allowed) return ko(405, 'METHOD_NOT_ALLOWED', 'Método no permitido', { allow: allowed });

    const role = new Map([
      ['Bearer demo-buyer', 'buyer'], ['Bearer demo-reader', 'reader'], ['Bearer demo-other', 'other'],
    ]).get(headers.authorization);
    if (!role) return ko(401, 'UNAUTHORIZED', 'Token ausente o inválido', { 'www-authenticate': 'Bearer' });
    if (orderMatch) {
      const order = orders.get(orderMatch[1]);
      if (!order || order.owner !== role) return ko(404, 'ORDER_NOT_FOUND', 'Pedido inexistente');
      if (cancel && order.data.status === 'CONFIRMED') {
        const { sku, quantity, coupon } = order.data;
        stock.set(sku, stock.get(sku) + quantity);
        if (coupon) redeemedCoupons.delete(role);
        order.data.status = 'CANCELLED';
      }
      return ok(200, order.data);
    }
    if (role === 'reader') return ko(403, 'FORBIDDEN', 'El perfil no puede crear pedidos');
    if (headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return ko(415, 'UNSUPPORTED_MEDIA_TYPE', 'Se requiere application/json');
    }
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      return ko(400, 'INVALID_JSON', 'JSON malformado');
    }
    if (!input || typeof input.sku !== 'string' || !Number.isInteger(input.quantity) ||
        input.quantity < 1 || input.quantity > 5) {
      return ko(422, 'INVALID_ORDER', 'Se requiere SKU y una cantidad entera entre 1 y 5');
    }
    const { sku, quantity, coupon } = input;
    if (coupon !== undefined && coupon !== couponCode) {
      return ko(422, 'INVALID_COUPON', 'Cupón inválido');
    }
    const key = headers['idempotency-key'];
    const scopedKey = key ? JSON.stringify([role, key]) : undefined;
    const previous = keys.get(scopedKey)?.data;
    if (previous) {
      if (previous.sku !== sku || previous.quantity !== quantity || previous.coupon !== coupon) {
        return ko(409, 'IDEMPOTENCY_CONFLICT', 'La clave ya se usó con otro pedido');
      }
      return ok(200, previous, { 'idempotency-replayed': 'true' });
    }
    if (!stock.has(sku)) return ko(404, 'SKU_NOT_FOUND', 'Producto inexistente');
    if (stock.get(sku) < quantity) return ko(409, 'OUT_OF_STOCK', 'Stock insuficiente');

    const subtotalCents = unitPrices.get(sku) * quantity;
    if (coupon && subtotalCents < 9000) {
      return ko(422, 'COUPON_MINIMUM_NOT_MET', 'El cupón requiere un subtotal de al menos 90 EUR');
    }
    if (coupon && redeemedCoupons.has(role)) {
      return ko(409, 'COUPON_ALREADY_USED', 'El cupón ya está aplicado a un pedido confirmado');
    }
    const discountCents = coupon ? subtotalCents / 10 : 0;
    const netCents = subtotalCents - discountCents;
    const shippingCents = netCents >= freeShippingMinimum ? 0 : 700;
    const id = 'ORD-' + (orders.size + 1);
    const data = {
      id, sku, quantity, status: 'CONFIRMED', coupon,
      pricing: { currency: 'EUR', subtotalCents, discountCents, shippingCents, totalCents: netCents + shippingCents },
    };
    const order = { owner: role, data };
    stock.set(sku, stock.get(sku) - quantity);
    if (coupon) redeemedCoupons.add(role);
    orders.set(id, order);
    if (scopedKey) keys.set(scopedKey, order);
    return ok(201, data, { location: '/api/orders/' + id });
  };
}
