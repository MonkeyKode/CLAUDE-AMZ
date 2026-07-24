# Amazon Seller MCP Server

Servidor MCP que expone 3 herramientas para gestionar tu tienda de Amazon (SP-API) desde Claude:

- `list_unshipped_orders` — pedidos sin enviar
- `update_price` — actualizar el precio de un SKU
- `get_inventory` — consultar stock de un SKU

## 1. Configurar credenciales

```bash
cp .env.example .env
```

Rellena `.env` con los valores que ya generaste:
- `LWA_APP_ID`, `LWA_CLIENT_SECRET`, `REFRESH_TOKEN` (de tu app SP-API autorizada)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SELLING_PARTNER_ROLE` (de tu usuario/rol IAM)
- `SELLER_ID`, `MARKETPLACE_ID`
- `MCP_ACCESS_TOKEN`: genera uno propio con `openssl rand -hex 32` — es la contraseña que usará Claude para hablar con TU servidor (distinta de las credenciales de Amazon).

**Nunca subas el archivo `.env` a un repositorio público.**

## 2. Probar en local

```bash
npm install
npm start
```

Deberías ver `Servidor MCP de Amazon corriendo en el puerto 3000`.

## 3. Desplegar para que Claude pueda alcanzarlo (HTTPS público)

Necesitas que este servidor sea accesible desde internet por HTTPS. Dos rutas razonables:

### Opción A — Render.com (más simple, recomendada para empezar)
1. Sube este proyecto a un repositorio de GitHub (privado está bien).
2. En Render.com: "New +" → "Web Service" → conecta el repo.
3. Build command: `npm install` — Start command: `npm start`.
4. En la sección "Environment", agrega todas las variables de tu `.env`.
5. Render te da automáticamente una URL HTTPS, ej. `https://amazon-mcp-server.onrender.com`.
6. Tu endpoint MCP será: `https://amazon-mcp-server.onrender.com/mcp`

### Opción B — AWS App Runner (te mantiene todo en la misma cuenta de AWS)
1. Sube el código a un repo (GitHub o CodeCommit) o a un artefacto en ECR.
2. AWS Console → App Runner → "Create service" → apunta a tu repo/imagen.
3. Configura las variables de entorno igual que en `.env`.
4. App Runner expone una URL HTTPS automáticamente.
5. Tu endpoint MCP será: `https://<tu-servicio>.awsapprunner.com/mcp`

En ambos casos, asegúrate de que el puerto que escucha la app coincida con el que la plataforma espera (usan la variable `PORT` automáticamente).

## 4. Conectar con Claude

1. En claude.ai (o Claude Desktop): **Configuración → Conectores → Agregar conector personalizado**
   (en cuentas Team/Enterprise, un Owner debe hacerlo primero desde Configuración de la Organización → Conectores).
2. Pega la URL de tu servidor: `https://tu-servidor.com/mcp`
3. Cuando te pida autenticación, ingresa el `MCP_ACCESS_TOKEN` que definiste en tu `.env` (como Bearer token).
4. Activa el conector en una conversación y prueba: *"muéstrame los pedidos sin enviar"*.

## Notas importantes

- **`update_price` requiere el `productType` de Amazon** (ej. `LUGGAGE`, `SHIRT`) para tu SKU. Si no lo sabes, puedes consultarlo con la operación `getListingsItem` de la Listings Items API antes de hacer el cambio — puedo agregar una herramienta extra para esto si te sirve.
- `get_inventory` usa la FBA Inventory API — si vendes con envío propio (FBM/MFN) en vez de Logística de Amazon, necesitarías una herramienta distinta basada en Listings Items en lugar de FBA Inventory. Dime si es tu caso y ajusto el código.
- Amazon anunció tarifas de suscripción para desarrolladores externos de SP-API a partir del 31 de enero de 2026 — vale la pena revisar si tu cuenta de desarrollador aplica a algún costo.
- Guarda tus credenciales (`.env`) fuera de cualquier repositorio público; en Render/App Runner configúralas como variables de entorno del servicio, no como archivo subido.
