# PaginaToto — Sistema de gestión de compraventa de autos

Aplicación web completa para administrar un negocio de compra y venta de vehículos:
stock, compras, gastos, cuotas, ventas, vehículos recibidos como parte de pago,
rentabilidad, finanzas, resúmenes, gráficos, historial, comparación según el dólar,
alertas, clientes/proveedores, estadísticas, exportación y papelera recuperable.

Todo funciona 100% en el navegador. Los datos se guardan automáticamente en el
navegador (localStorage) — no se envía nada a internet.

## Cómo abrirla

**Opción rápida:** doble clic en `Abrir PaginaToto.bat` (necesita Python instalado).
Se abre en `http://localhost:4599/index.html`.

**Manual:** desde esta carpeta, ejecutar:

```
python -m http.server 4599
```

y entrar a `http://localhost:4599/index.html`.

> Se usa un mini servidor local porque los navegadores bloquean parte del
> funcionamiento al abrir el `index.html` directamente con doble clic (`file://`).

## Estado inicial

La aplicación comienza vacía. No carga vehículos ni movimientos de demostración.
En la versión online, la etapa comercial vigente se obtiene de Supabase; los datos
locales anteriores de otra etapa se invalidan al iniciar sesión, sin borrar la
sesión ni las preferencias del navegador.

## Copia de seguridad

En **Exportar** podés descargar toda la base en JSON (y volver a importarla),
además de exportar autos, movimientos, compras, ventas y resúmenes en CSV/Excel.

En la versión online, **Ajustes → Auditoría** consulta el registro por fila de
PostgreSQL y los eventos de importación/restauración. **Ajustes → Copias y
restauración** muestra snapshots diarios y manuales, sin vencimiento automático.
La versión online utiliza `audit_log`, `app_trash`, `app_operations` y
`app_snapshots` en Supabase. Las migraciones y el informe de instalación están en
`SUPABASE/`; los snapshots no vencen automáticamente. La versión local guarda
copias solo en `localStorage`, sujeto al espacio de ese navegador.

## Regenerar bundles

Después de editar fuentes, ejecutar `node scripts/build-inline-bundles.js` desde
la raíz del repositorio. El script actualiza los HTML autocontenidos y la versión
de caché de los módulos principales.

## Estructura del proyecto

```
index.html            Punto de entrada
assets/styles.css     Estilos (diseño responsive, modo claro/oscuro automático)
js/store.js           Estado global, persistencia y operaciones de datos
js/finance.js         Cálculos financieros, métricas, resúmenes y estadísticas
js/ui.js              Componentes: modales, toasts, formularios, gráficos SVG
js/forms.js           Formularios de vehículo, compra, venta, gasto y cuotas
js/views1.js          Dashboard y ficha de vehículo
js/views2.js          Finanzas, resúmenes, gráficos, historial, comparación, etc.
js/app.js             Navegación y router
```

## Notas sobre monedas y cotización del dólar

- Cada compra, venta y gasto guarda **su propia cotización histórica** del dólar.
  Esa cotización no se recalcula nunca.
- La **cotización actual** (Ajustes, o el campo manual en *Comparación dólar*)
  sólo se usa para proyecciones y comparaciones; no modifica ningún valor histórico.
- Los totales se muestran en pesos y, cuando aporta, también en dólares.
