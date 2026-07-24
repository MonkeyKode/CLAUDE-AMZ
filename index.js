import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import SellingPartnerAPI from 'amazon-sp-api';

// ---------------------------------------------------------------------------
// 1) Cliente de Amazon SP-API (usa tus credenciales LWA + AWS IAM)
// ---------------------------------------------------------------------------
const spClient = new SellingPartnerAPI({
  region: process.env.SPAPI_REGION || 'na', // 'na' cubre México, EE.UU., Canadá, Brasil
  refresh_token: process.env.REFRESH_TOKEN,
  credentials: {
    SELLING_PARTNER_APP_CLIENT_ID: process.env.LWA_APP_ID,
    SELLING_PARTNER_APP_CLIENT_SECRET: process.env.LWA_CLIENT_SECRET,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SELLING_PARTNER_ROLE: process.env.AWS_SELLING_PARTNER_ROLE,
  },
});

const MARKETPLACE_ID = process.env.MARKETPLACE_ID;
const SELLER_ID = process.env.SELLER_ID;

// ---------------------------------------------------------------------------
// 2) Definición del servidor MCP y sus herramientas
// ---------------------------------------------------------------------------
function buildMcpServer() {
  const server = new McpServer({
    name: 'amazon-seller-mcp',
    version: '1.0.0',
  });

  // --- Herramienta: listar pedidos sin enviar ---
  server.registerTool(
    'list_unshipped_orders',
    {
      title: 'Pedidos sin enviar',
      description: 'Devuelve los pedidos de Amazon que aún no han sido enviados (estado Unshipped).',
      inputSchema: {
        maxResults: z.number().int().min(1).max(100).default(20)
          .describe('Número máximo de pedidos a devolver'),
      },
    },
    async ({ maxResults }) => {
      try {
        const result = await spClient.callAPI({
          operation: 'getOrders',
          endpoint: 'orders',
          query: {
            MarketplaceIds: [MARKETPLACE_ID],
            OrderStatuses: ['Unshipped', 'PartiallyShipped'],
            MaxResultsPerPage: maxResults,
          },
        });

        const orders = (result?.Orders || []).map((o) => ({
          orderId: o.AmazonOrderId,
          fecha: o.PurchaseDate,
          estado: o.OrderStatus,
          total: o.OrderTotal ? `${o.OrderTotal.Amount} ${o.OrderTotal.CurrencyCode}` : null,
          canalDeEnvio: o.FulfillmentChannel,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify({ count: orders.length, orders }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error al consultar pedidos: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Herramienta: actualizar precio de un SKU ---
  server.registerTool(
    'update_price',
    {
      title: 'Actualizar precio de un SKU',
      description: 'Cambia el precio de venta de un producto (SKU) en tu tienda de Amazon.',
      inputSchema: {
        sku: z.string().describe('El SKU del producto a actualizar'),
        newPrice: z.number().positive().describe('El nuevo precio (sin impuestos)'),
        currency: z.string().default('MXN').describe('Código de moneda, ej. MXN, USD'),
        productType: z.string().describe(
          'El "productType" de Amazon para este SKU (ej. LUGGAGE, SHIRT). ' +
          'Debes conocerlo de antemano; se puede consultar con getListingsItem si no lo tienes.'
        ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ sku, newPrice, currency, productType }) => {
      try {
        const result = await spClient.callAPI({
          operation: 'patchListingsItem',
          endpoint: 'listingsItems',
          path: {
            sellerId: SELLER_ID,
            sku,
          },
          query: {
            marketplaceIds: [MARKETPLACE_ID],
          },
          body: {
            productType,
            patches: [
              {
                op: 'replace',
                path: '/attributes/purchasable_offer',
                value: [
                  {
                    marketplace_id: MARKETPLACE_ID,
                    currency,
                    our_price: [
                      {
                        schedule: [{ value_with_tax: newPrice }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Precio de ${sku} actualizado a ${newPrice} ${currency}. Respuesta de Amazon: ${JSON.stringify(result)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error al actualizar el precio: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Herramienta: consultar stock de un SKU ---
  server.registerTool(
    'get_inventory',
    {
      title: 'Consultar inventario',
      description: 'Consulta cuánto stock (unidades disponibles) tienes de un SKU específico.',
      inputSchema: {
        sku: z.string().describe('El SKU del producto a consultar'),
      },
    },
    async ({ sku }) => {
      try {
        const result = await spClient.callAPI({
          operation: 'getInventorySummaries',
          endpoint: 'fbaInventory',
          query: {
            granularityType: 'Marketplace',
            granularityId: MARKETPLACE_ID,
            marketplaceIds: [MARKETPLACE_ID],
            sellerSkus: [sku],
          },
        });

        const summary = result?.inventorySummaries?.[0];
        const disponible = summary?.inventoryDetails?.fulfillableQuantity ?? 'No encontrado (¿es FBM en vez de FBA?)';

        return {
          content: [{ type: 'text', text: `Stock disponible de ${sku}: ${disponible}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error al consultar inventario: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// 3) Servidor HTTP (Streamable HTTP transport) con autenticación por token
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  // Autenticación básica por Bearer token propio (no confundir con OAuth de Amazon).
  const authHeader = req.headers['authorization'];
  const expected = `Bearer ${process.env.MCP_ACCESS_TOKEN}`;
  if (!process.env.MCP_ACCESS_TOKEN || authHeader !== expected) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor MCP de Amazon corriendo en el puerto ${PORT}`);
});
