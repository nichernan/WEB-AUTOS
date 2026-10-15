# Seguridad y recuperación — WebTotoAuto

## Estado de la entrega (15/10/2026)

Proyecto Supabase verificado e intervenido: `wprhqjmhsqwncbhouxvl` (`Pagina Toto Botta`). No se utilizó ni modificó ningún otro proyecto.

Se instalaron y verificaron las migraciones `webtoto_security_recovery_delivery_generation`, `webtoto_harden_auth_helpers`, `webtoto_private_rls_helpers` y `webtoto_guard_kv_delivery_generation`. La última migración agrega la generación a `kv`, restringe su RLS y rechaza escrituras sin la etapa vigente.

La limpieza de entrega fue atómica y protegida por conteos esperados. Antes de limpiar había 4 vehículos, 20 filas de historial, 0 recordatorios, 3 gastos fijos y 1 fila `kv` (`meta`). Se conservaron `auth.users` (1) y `profiles` (1), sin cambiar rol ni estado: el perfil sigue activo con rol `usuario`. No se tocaron claves, contraseñas ni configuración de Auth.

Conteos después del corte:

| Tabla/estado | Filas |
|---|---:|
| `vehicles` | 0 |
| `history` | 0 |
| `reminders` | 0 |
| `fixed_expenses` | 0 |
| `kv` | 0 |
| `app_trash` | 0 |
| `audit_log` | 28 |
| `app_snapshots` | 1 |
| `app_operations` | 1 |
| `app_delivery_state` | 1 |
| `auth.users` | 1 |
| `profiles` | 1 |

`audit_log` conserva 4 DELETE de `vehicles`, 20 de `history`, 3 de `fixed_expenses` y 1 de `kv`; cada uno tiene `before_data` completo y los 28 comparten `transaction_id`. Las filas de auditoría ocurrieron antes del corte de generación y la interfaz las rotula **PREVIO A LA ENTREGA**.

Se creó el punto `Estado inicial — Entrega al dueño`, con vehículos, historial, recordatorios, gastos fijos y papelera vacíos, más los valores iniciales de configuración. `app_operations` registra el corte y sus cantidades. Ningún snapshot previo con datos viejos fue creado; las imágenes que la auditoría SQL debe conservar son la única evidencia histórica de esas filas.

## Estado comercial que maneja la app

Las tablas comerciales existentes son `vehicles`, `history`, `reminders`, `fixed_expenses` y `kv`. Compras, ventas, cuotas y gastos de vehículo están dentro del JSON de cada vehículo; no existen tablas remotas adicionales para ellos. Los ajustes y metadatos viven en `kv`. `profiles` enlaza con `auth.users` y se mantiene fuera de las restauraciones comerciales.

El cliente usa `store.js` como estado de dominio y `sync.js` para descargar y enviar diferencias por ID. La actualización normal usa `upsert`; los IDs que desaparecen del estado se envían como DELETE. Importación, restauración y reinicio reemplazan el estado del store. La papelera de la app conserva eliminaciones recuperables; la auditoría SQL observa las escrituras reales en PostgreSQL independientemente de la interfaz.

## Auditoría de PostgreSQL

`audit_log` recibe cambios mediante triggers en `profiles`, `vehicles`, `history`, `reminders`, `fixed_expenses` y `kv`:

- INSERT: `after_data` completo.
- UPDATE: `before_data` y `after_data` completos.
- DELETE: `before_data` completo.
- TRUNCATE: el trigger `BEFORE TRUNCATE` toma cada fila existente y escribe un evento individual antes del vaciado.

Las operaciones por fila de una transacción comparten `transaction_id`. Para SQL Editor/conexiones sin contexto de Auth, `actor_uid` puede ser NULL; `db_role` sigue mostrando el rol de base disponible. Una sentencia directa `DELETE FROM vehicles` no depende de JavaScript y produce un registro DELETE por cada vehículo con su imagen anterior completa.

Permisos efectivos: usuarios autenticados activos pueden consultar `audit_log`; no reciben INSERT, UPDATE, DELETE ni TRUNCATE por API. El trigger escribe con privilegios de su propietario y un trigger adicional rechaza UPDATE/DELETE/TRUNCATE. La clave `service_role` no está en el navegador. Un propietario PostgreSQL puede alterar triggers/objetos; para resistir a ese nivel administrativo se requiere exportación externa/WORM.

## Papelera y operaciones de la aplicación

`app_trash` conserva el elemento eliminado, entidad, ID, fecha, autor y marca de restauración. La app puede leer e insertar; solo puede actualizar `restored_at`, nunca borrar definitivamente ni alterar el contenido original. La restauración vuelve a crear/aplicar el registro y PostgreSQL audita ese cambio.

`app_operations` registra importación, restauración, reinicio, cambio masivo y corte de entrega. Es append-only para usuarios normales y no sustituye `audit_log`: este último registra los cambios efectivos fila por fila.

## Snapshots y restauración

Cada snapshot completo contiene el estado comercial producido por el store: `vehicles` (incluidos datos anidados), `history`, `reminders`, `fixedExpenses`, `settings`, `meta` y `trash`. No contiene perfiles ni credenciales.

Después de una sincronización correcta, `sync.js` busca el snapshot `daily` del día de negocio en `America/Argentina/Buenos_Aires`. Si no existe crea uno; el índice único en `snapshot_day` bloquea duplicados concurrentes. El día se calcula en la misma zona horaria en cliente y PostgreSQL. También se crean copias explícitas antes de importar, reiniciar, restaurar y enviar una operación de sincronización masiva.

Al restaurar, primero se inserta `Estado anterior a restauración` y luego se registra la operación. Si la copia o el registro obligatorio falla, se cancela el cambio. Después se aplica el estado seleccionado mediante el flujo normal de diferencias; los triggers auditan cada INSERT/UPDATE/DELETE y nunca se restauran usuarios o credenciales.

No existe expiración ni job que borre automáticamente auditoría, papelera, operaciones o snapshots. La retención depende del almacenamiento disponible en Supabase; snapshots diarios crecen aproximadamente como 365 veces el tamaño del estado JSON por año.

## Sincronización y generación de entrega

Al instalar la nueva generación, el cliente compara `paginaToto:businessGeneration` con `app_delivery_state`. Si no coincide (incluido un navegador antiguo que no tenga clave), elimina únicamente `paginaToto:v1`, `paginaToto:syncBase` y `paginaToto:snapshots`, conserva la sesión y preferencias, y descarga el estado remoto de la nueva etapa. Sin generación válida, las escrituras quedan bloqueadas.

Los triggers y RLS exigen la generación vigente en JSON de vehículos, historial, recordatorios y gastos fijos; `kv` usa una columna `generation`. Esto impide que una versión vieja o una sincronización offline reinserte datos previos aun si conserva su `localStorage`. También impide leer o modificar filas de otras generaciones desde la API.

La barrera masiva de `sync.js` se calcula según el tamaño real del shadow remoto: en tablas de hasta 3 filas bloquea borrar todo o actualizar todas; desde 3 filas pide confirmación para altas en lote; en tablas mayores usa como umbral el máximo entre 3 y la mitad redondeada hacia arriba para borrados o upserts. Antes de enviar esos cambios guarda el shadow remoto como snapshot, confirma el `app_operations` y solo entonces manda las mutaciones. Si falla el backup o el log, no manda el lote. Una sincronización correcta crea el snapshot diario después del envío; ese punto diario no sustituye al backup previo.

## RLS y límites

Los helpers `SECURITY DEFINER` se guardan en `app_private`, esquema no expuesto por PostgREST, con `search_path` fijo y ejecución solo para `authenticated`. Se quitaron los RPC públicos antiguos `is_active_user()` y `is_admin()`. La aplicación no requiere service role.

`audit_log`, `app_snapshots`, `app_trash`, `app_operations` y `app_delivery_state` tienen RLS y permisos explícitos. La auditoría, snapshots y operaciones son append-only para usuarios de API. Las políticas no protegen contra el propietario de la base ni una clave administrativa comprometida.

El asesor de seguridad solo conserva el aviso de Supabase **Leaked Password Protection Disabled**. No se alteró Auth ni la política de contraseñas para respetar la instrucción de conservar la configuración actual.

## Pruebas realizadas

- Suite aislada en PostgreSQL 17 descartable: PASS A–I; incluye INSERT, UPDATE completo antes/después, DELETE individual, DELETE de 12 vehículos con 12 imágenes, TRUNCATE con cada fila, fecha argentina, RLS/permisos append-only y rechazo de filas viejas en negocio y `kv`. El contenedor de prueba se eliminó.
- Restauración y sincronización aisladas en Node: PASS A→B→A, backup anterior a restauración con B, snapshot previo → app_operations → DELETE masivo.
- Interfaz local en `localhost`, fuera de Supabase: estado vacío; alta y edición de un vehículo ficticio, papelera/restauración, snapshot A y B, restauración A y copia automática B. Los datos y snapshots ficticios fueron retirados del almacenamiento local.
- Revisada la vista móvil a 390 px; parseo de scripts embebidos y sintaxis de los módulos: PASS.
- En producción, la limpieza misma verificó 28 capturas completas y un solo `transaction_id`; conteos de negocio y papelera terminaron en cero.

No se hizo una autenticación interactiva contra el usuario real: no se proporcionó ni se manipuló su contraseña. Auth y perfil se conservaron; el login debe ser confirmado por el dueño al abrir la versión publicada. Tampoco se crearon registros de prueba en producción, para que la papelera comercial de entrega quedara en cero.

## Archivos y migraciones

Migraciones instaladas: `2-seguridad-y-recuperacion.sql`, `3-endurecer-permisos-auth.sql`, `4-kv-generation-guard.sql`. Limpieza guardada y ejecutada: `5-entrega-inicial-vacia.sql`; aborta si los conteos no coinciden.

Cambios de app: `js/store.js`, `js/sync.js`, `js/views2.js`, estilos, README y versiones de caché. Se regeneraron `PaginaToto-WEB/index.html` y `PaginaToto.html` desde las fuentes con `scripts/build-inline-bundles.js`.
