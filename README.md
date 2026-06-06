# Cortesanos Feria Venta

Deploy recomendado: Cloudflare Pages + Pages Functions + Supabase.

## Cloudflare Pages

```txt
Build command: npm run build
Build output directory: client/dist
Root directory: /
Node version: 20
```

La configuracion de Pages tambien esta fijada en `wrangler.jsonc`.

## Variables

Configurar en Cloudflare Pages > Settings > Environment variables:

```txt
SUPABASE_URL=https://cbiueehyimiazouplpeh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=pegar-service-role-key
ADMIN_PASSWORD=clave-del-panel
SESSION_SECRET=texto-largo-random
WHATSAPP_TARGET=543492717777
```

## Datos del catalogo

Editar:

```txt
client/public/data/site.config.json
client/public/data/wines.config.json
```

Para activar venta:

```json
"showPrices": true,
"enableOrders": true
```

Panel admin:

```txt
/admin-cortesanos
```
