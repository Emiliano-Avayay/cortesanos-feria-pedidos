# Cultura Cortesana - Catálogo Premium

Aplicación web real para vender vinos con descuento durante la feria.

## Arranque rápido en Windows

Opción simple: doble clic en `start-windows.bat`.

O por CMD:

```cmd
cd /d C:\Users\vinot\OneDrive\Escritorio\Webs\cultura-cortesana-web-catalog-premium-v2
npm install
copy .env.example .env
npm run build
npm start
```

Abrir:

- Web pública: http://localhost:3000
- Panel admin: http://localhost:3000/admin-cortesanos

## Configuración principal

Archivo:

```txt
config/site.config.json
```

Para mostrar precios:

```json
"showPrices": true
```

Para activar pedidos:

```json
"enableOrders": true
```

Para agregar fondo real:

1. Guardar imagen en `client/public/assets/backgrounds/catalog-bg.webp`
2. Configurar:

```json
"catalogBackgroundImage": "/assets/backgrounds/catalog-bg.webp"
```

## Códigos de entrada

El cliente no elige si es General o VIP. Ingresa un código y el sistema define el acceso.

```json
"ticketAccess": {
  "enabled": true,
  "generalCodes": ["GENERAL-2026"],
  "vipCodes": ["VIP-2026"],
  "codes": [
    { "code": "GEN-001", "type": "general" },
    { "code": "VIP-001", "type": "vip" }
  ]
}
```

## Vinos

Archivo:

```txt
config/wines.config.json
```

Las imágenes se cargan manualmente en:

```txt
client/public/assets/wines/
```

Ejemplo:

```txt
client/public/assets/wines/aduentus-classic.webp
```

Si falta la imagen, se muestra un placeholder premium.

## Variables de entorno

Archivo `.env`:

```env
ADMIN_PASSWORD=tu_clave_privada
SESSION_SECRET=texto_largo_secreto
WHATSAPP_TARGET=543492717777
PORT=3000
```

## Validaciones incluidas

- El backend no envía precios públicos si `showPrices` es `false`.
- El backend no permite pedidos si `enableOrders` es `false`.
- El backend calcula subtotal, voucher y total final.
- Cliente General no puede comprar vinos VIP.
- Panel admin protegido por contraseña.
- Pedidos guardados en SQLite (`data/orders.sqlite`).


## Cambios V5 — Acceso General/VIP

Al entrar por primera vez, la web muestra una ventana obligatoria:

- Si el cliente toca **No, continuar como General**, entra con voucher General de $25.000 sin ingresar código.
- Si toca **Sí, tengo entrada VIP**, debe ingresar el código VIP para aplicar voucher de $65.000.
- Los vinos destacados pueden comprarse con entrada General o VIP. El código solo cambia el voucher.

El acceso General sin código se controla desde `config/site.config.json`:

```json
"ticketAccess": {
  "enabled": true,
  "defaultGeneralAccess": true
}
```

Para pedir código también a General, cambiar `defaultGeneralAccess` a `false`.

En el checkout se muestra la aclaración para que el cliente use el mismo nombre, apellido y número de WhatsApp con el que compró la entrada.

## Cambios V6 — voucher al finalizar compra

- La página ya no abre con modal inicial.
- El cliente entra directo al catálogo.
- Por defecto, todo pedido usa voucher General de $25.000.
- En el checkout se pregunta si tiene voucher VIP.
- Si marca VIP, debe cargar código.
- El voucher VIP aplica $65.000, pero tiene límite de 50 pedidos.
- Los códigos VIP son de un solo uso si `requireUniqueVipCode` está en `true`.
- El límite se controla con:

```json
"vipVoucherLimit": 50
```

Para evitar que compartan códigos, usar 50 códigos únicos en `config/site.config.json`:

```json
"codes": [
  { "code": "VIP-001", "type": "vip" },
  { "code": "VIP-002", "type": "vip" },
  { "code": "VIP-003", "type": "vip" }
]
```

Opcionalmente se puede atar cada código a nombre y teléfono:

```json
"codes": [
  { "code": "VIP-001", "type": "vip", "name": "Juan Pérez", "phone": "3492123456" }
]
```

Si se cargan `name` y `phone`, el backend exige que el cliente use esos mismos datos en checkout.
