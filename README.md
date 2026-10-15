# PaginaToto — Gestión de compraventa de autos

Aplicación web para administrar un negocio de compra y venta de vehículos: stock,
compras, gastos, cuotas, ventas, gastos fijos del negocio, comisiones, finanzas,
resúmenes, historial, alertas y recordatorios, clientes/proveedores, exportación a
Excel y papelera.

## Contenido del repositorio

| Carpeta / archivo | Qué es |
|---|---|
| `PaginaToto-WEB/` | **Versión web actual**, lista para publicar (Netlify, GitHub Pages, etc.). Multi-usuario: login con email y contraseña, datos compartidos en tiempo real vía Supabase, administrador de usuarios desde Ajustes. |
| `PaginaToto.html` | Versión de un solo archivo para uso local (doble clic), sin login ni internet — datos guardados en el navegador. |
| `PaginaToto-CODIGO-FUENTE/` | Código fuente separado en archivos (`index.html`, `assets/styles.css`, `js/*.js`). Es lo que se edita; luego se regenera `PaginaToto.html` y `PaginaToto-WEB/index.html` a partir de acá. |
| `SUPABASE/` | Pasos y scripts para configurar el backend (base de datos, políticas de seguridad y la función que administra usuarios) en un proyecto de Supabase propio. |
| `LÉEME.txt` | Guía de uso de la versión local (`PaginaToto.html`). |
| `PUBLICAR EN INTERNET.txt` | Cómo publicar `PaginaToto-WEB/` para compartir un link. |

## Publicar la versión web

1. Las fuentes están en `PaginaToto-CODIGO-FUENTE/`; los bundles se regeneran con
   `node scripts/build-inline-bundles.js`.
2. `wrangler.toml` publica `PaginaToto-WEB/` como assets estáticos del Worker
   `web-autos` de Cloudflare.
3. El backend de producción es el proyecto Supabase WebTotoAuto `wprhqjmhsqwncbhouxvl`.
   Las migraciones, verificaciones y estado de la entrega se describen en
   `SUPABASE/SEGURIDAD-Y-RECUPERACION.md`.

## Notas de seguridad

- La clave incluida en `PaginaToto-WEB/index.html` (`supabaseKey`) es la clave
  **anónima/pública** de Supabase: está pensada para vivir en el cliente y el
  acceso a los datos queda controlado por Row Level Security (RLS) en la base.
- La clave de administrador de Supabase (`service role`) **no** está en este
  repositorio: vive únicamente como variable de entorno en la Edge Function,
  inyectada automáticamente por Supabase.
