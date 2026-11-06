# QA API Portfolio · Tienda demo

Este es mi portfolio de pruebas de API. Lo armé alrededor de una tienda ficticia para mostrar cómo paso de una regla de negocio a escenarios reproducibles, y cómo verifico que un rechazo o un reintento no deje el inventario ni los pedidos en un estado incorrecto.

El proyecto reúne un laboratorio HTTP, el contrato OpenAPI y una suite automatizada. Cada caso tiene un ID, solicitudes y resultados esperados. Los ejemplos de Swagger enlazan con la matriz, donde se puede seguir cada secuencia completa.

- [Explorar la API en Swagger](https://falvarezspain.github.io/qa-api-portfolio/)
- [Consultar la matriz de casos](https://falvarezspain.github.io/qa-api-portfolio/casos.html)
- [Ver ejecuciones de GitHub Actions](https://github.com/falvarezspain/qa-api-portfolio/actions/workflows/qa.yml)

## Qué hace la tienda

El laboratorio tiene un catálogo de demostración y permite crear, consultar y cancelar pedidos. Cada pedido tiene un SKU y una cantidad de 1 a 5. El teclado cuesta 45 EUR y comienza con 5 unidades. El ratón cuesta 20 EUR y comienza agotado. Los importes de la API se expresan en céntimos.

| Regla | Comportamiento |
| --- | --- |
| Precio y envío | El envío cuesta 7 EUR. Es gratis desde 90 EUR de importe neto, después de aplicar el descuento. |
| Cupón DEMO10 | Descuenta el 10 % a partir de 90 EUR de subtotal. Cada comprador puede tener un solo pedido confirmado con el cupón. |
| Reserva y cancelación | Crear un pedido descuenta unidades. La primera cancelación devuelve esas unidades y libera el cupón. Repetir la cancelación devuelve el mismo estado. |
| Permisos | Los compradores pueden consultar y cancelar sus propios pedidos. Una identidad ajena recibe 404. El perfil lector recibe 403 al intentar comprar. |
| Reintentos | La clave de idempotencia pertenece al comprador. Repetir SKU, cantidad y cupón devuelve el mismo pedido con su estado actual. Reutilizar la clave con datos válidos distintos devuelve 409. Los pedidos rechazados no consumen stock ni guardan la clave. |

## Casos que recomiendo revisar

| Caso | Qué demuestra |
| --- | --- |
| [NEG-02 · Descuento y umbral de envío](https://falvarezspain.github.io/qa-api-portfolio/casos.html#NEG-02) | Dos teclados suman 90 EUR. El descuento deja 81 EUR de neto, se aplican 7 EUR de envío y el total queda en 88 EUR. El pedido consultado conserva el mismo desglose. |
| [NEG-04 · Rechazo sin efectos secundarios](https://falvarezspain.github.io/qa-api-portfolio/casos.html#NEG-04) | Un cupón por debajo del mínimo devuelve 422. El siguiente pedido puede reutilizar la clave y el stock restante permite completar una compra posterior. |
| [NEG-08 · Cancelación y nueva compra](https://falvarezspain.github.io/qa-api-portfolio/casos.html#NEG-08) | Se agotan las cinco unidades, se comprueba el rechazo y, tras cancelar, se vuelven a comprar las cinco con el mismo cupón. |
| [NEG-11 · Reintento tras cancelar](https://falvarezspain.github.io/qa-api-portfolio/casos.html#NEG-11) | Repetir la creación con la misma clave recupera el pedido cancelado. Una compra nueva genera otro ID. |
| [NEG-13 · Cancelación repetida de un pedido anterior](https://falvarezspain.github.io/qa-api-portfolio/casos.html#NEG-13) | El pedido nuevo conserva su cupón aunque se repita la cancelación del anterior. |

## Cómo pruebo la API

La suite incluye **52 casos de regresión black-box**, con **4 smoke** para comprobar salud, catálogo, creación y consulta de un pedido, y rechazo sin token. Cada caso arranca un servidor aislado y realiza peticiones HTTP. Compruebo el código de estado, las cabeceras relevantes y el cuerpo completo. Cuando hay un cambio de estado, añado peticiones posteriores para observar sus efectos sobre el pedido, el inventario o el cupón.

| Área | Cobertura |
| --- | --- |
| Catálogo y redirecciones | Caché con ETag, Location, y preservación del método y el cuerpo en redirecciones POST. |
| Pedidos y reglas comerciales | Validación de datos, stock, permisos, precios, cupones, cancelaciones e idempotencia. |
| Resiliencia | Errores 500, 502, 503 y 504 simulados, cabecera Retry-After y salud posterior al fallo interno. |

Los casos cubren respuestas OK (200 y 201), redirecciones y caché (301, 302, 304, 307 y 308), rechazos de cliente (400, 401, 403, 404, 405, 409, 413, 415 y 422) y fallos simulados de servidor y proveedor.

## Reproducir el laboratorio

Con Node.js 22 o superior, cloná el repositorio e iniciá la API. Swagger UI carga sus recursos desde jsDelivr.

```sh
git clone https://github.com/falvarezspain/qa-api-portfolio.git
cd qa-api-portfolio
npm start
```

1. Abrí [Swagger local](http://127.0.0.1:3000/), pulsá **Authorize** e ingresá `demo-buyer`.
2. En **POST /api/orders**, seleccioná el ejemplo de cupón válido con envío o enviá `{"sku":"SKU-100","quantity":2,"coupon":"DEMO10"}`.
3. Consultá el ID recibido con **GET /api/orders/{id}** y cancelalo con **POST /api/orders/{id}/cancel**.
4. Repetí la compra para comprobar que el cupón y el stock volvieron a quedar disponibles. Si incluiste una clave de idempotencia en la primera compra, usá una nueva para esta operación.

La versión pública de Swagger permite consultar el contrato y los ejemplos. **Try it out** funciona en el laboratorio local. Los datos y tokens son ficticios. El estado se guarda en memoria, por lo que reiniciar el servidor restaura los datos iniciales. El stock del catálogo representa ese estado inicial y la disponibilidad real se comprueba al comprar.

```sh
npm run test:smoke
npm run test:regression
npm run verify
```

GitHub Actions ejecuta las suites y publica el portfolio de `main` después de que pasan las pruebas. `npm run verify` comprueba también que la matriz y el contrato estén actualizados. Si cambiás los casos o las definiciones de OpenAPI, regenerá ambos con `npm run docs`.

- [Casos y resultados esperados](cases.mjs)
- [Ejecutor de pruebas HTTP](test/black-box.test.mjs)
- [API de demostración](src/api.mjs)
- [Contrato OpenAPI](public/openapi.json)
