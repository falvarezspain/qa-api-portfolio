# QA API Portfolio · Tienda demo

Portfolio de QA para revisión freelance. El laboratorio reproduce un catálogo y un flujo de pedidos de una tienda ficticia. La documentación y la matriz están en español. Los datos, las identidades y los fallos del proveedor son de demostración.

## Ejecutar en 2 minutos

Requisito: Node.js 22 o superior. La API y las pruebas usan módulos nativos. Swagger UI carga sus recursos desde jsDelivr.

```sh
npm start
```

- [Swagger UI y Try it out](http://127.0.0.1:3000/)
- [Matriz de casos y pasos](http://127.0.0.1:3000/casos.html)
- [Contrato OpenAPI 3.0.3](public/openapi.json)

En Swagger, abre **Authorize** e ingresa `demo-buyer`. Prueba **POST /api/orders** con `{"sku":"SKU-100","quantity":1}` y consulta el ID devuelto mediante **GET /api/orders/{id}**. Prueba `SKU-200` para observar el `409 OUT_OF_STOCK`, o utiliza el token `demo-reader` para observar el `403 FORBIDDEN`. Usa `demo-other` para comprobar que otro comprador no puede consultar el pedido. El stock y los pedidos se guardan en memoria. Reinicia el laboratorio para restaurar el estado inicial.

## Cobertura

| Área | Qué se verifica |
| --- | --- |
| Catálogo | Salud, datos iniciales y comportamiento condicional con ETag |
| Redirecciones | Cabecera Location y preservación del método POST y del cuerpo en 307 y 308 |
| Pedidos | Creación y consulta, roles, aislamiento de pedidos, stock, límites, validación e idempotencia |
| Resiliencia | Respuestas simuladas de servidor y proveedor, Retry-After y salud posterior al fallo interno |

| Familia | Estados ejercitados |
| --- | --- |
| 2xx · OK | 200, 201 |
| 3xx · redirección o caché, sin cuerpo | 301, 302, 304, 307, 308 |
| 4xx · KO | 400, 401, 403, 404, 405, 409, 413, 415, 422 |
| 5xx · KO simulado | 500, 502, 503, 504 |

Cada uno de los 39 casos tiene un ID, pasos y resultado esperado. Los 4 smoke cubren salud, catálogo, creación con consulta y rechazo sin token. Regresión incluye los 39 casos. El cliente de pruebas observa la interfaz HTTP y compara código de estado, cabeceras relevantes y cuerpo completo. Cada caso arranca un servidor aislado en un puerto efímero.

## Ejecutar suites

```sh
npm run test:smoke
npm run test:regression
npm run verify
```

GitHub Actions ejecuta smoke y la regresión en cada push o pull request. `npm run verify` también verifica que el contrato y la matriz coincidan con los casos del repositorio. Ejecuta `npm run docs` tras editar los casos o las definiciones OpenAPI.

En GitHub Pages, el portfolio muestra Swagger y la matriz pública de casos. El workflow publica esa documentación desde `main` cuando pasan las pruebas. Para ejecutar peticiones con **Try it out**, inicia la API local.

Swagger muestra el resultado final cuando el navegador sigue un redirect. Para observar la respuesta 3xx original, usa la suite automatizada o ejecuta:

```sh
curl -i http://127.0.0.1:3000/api/catalog
curl -i -H "If-None-Match: \"catalog-v1\"" http://127.0.0.1:3000/api/products
curl -i http://127.0.0.1:3000/api/lab/fault?scenario=unavailable
```

## Estructura

| Archivo | Propósito |
| --- | --- |
| [cases.mjs](cases.mjs) | Escenarios y resultados esperados, independientes del código de la API |
| [test/black-box.test.mjs](test/black-box.test.mjs) | Ejecutor HTTP |
| [src/api.mjs](src/api.mjs) | API de demostración |
| [public/openapi.json](public/openapi.json) | Contrato y ejemplos de respuestas |
| [public/casos.html](public/casos.html) | Matriz navegable |
| [.github/workflows/qa.yml](.github/workflows/qa.yml) | Integración continua |

Alcance del laboratorio: pruebas funcionales, de contrato observable y de resiliencia simulada. El token y el inventario son de demostración. El snapshot del catálogo es fijo y el stock operativo se valida al crear pedidos. El caso 504 devuelve el estado de forma inmediata para que la prueba sea determinista.
