# PaginaToto — Sistema de gestión de compraventa de autos

Aplicación web completa para administrar un negocio de compra y venta de vehículos:
stock, compras, gastos, cuotas, ventas, vehículos recibidos como parte de pago,
rentabilidad, finanzas, resúmenes, gráficos, historial, comparación según el dólar,
alertas, clientes/proveedores, estadísticas, exportación y papelera.

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

## Datos de ejemplo

La primera vez se cargan 3 autos de ejemplo para que la app no se vea vacía.
Se pueden borrar todos desde **Ajustes → Reiniciar todos los datos**.

## Copia de seguridad

En **Exportar** podés descargar toda la base en JSON (y volver a importarla),
además de exportar autos, movimientos, compras, ventas y resúmenes en CSV/Excel.

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
