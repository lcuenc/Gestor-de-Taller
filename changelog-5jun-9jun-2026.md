# Changelog — Gestión de Activos · Movimiento de Suelo
**Período:** 5 de junio al 9 de junio de 2026

---

## 5 de junio

### Módulo: Layout del Taller *(nuevo)*
- Se incorporó una vista de **mapa visual del taller** que representa gráficamente las bahías de trabajo y los equipos asignados a cada posición.
- Los equipos se muestran con su estado actual (color y etiqueta), permitiendo ver de un vistazo la ocupación del piso.
- La configuración de bahías quedó ajustada a la distribución real: se retiró una bahía y se renumeraron las restantes.

### Módulo: KPIs
- Se agregó la posibilidad de **descargar los indicadores en formato Excel** directamente desde la vista de KPIs.
- Se mejoró el scroll del listado de técnicos dentro de los modales para facilitar la navegación cuando hay muchos técnicos cargados.

### Módulo: Venta / GPV
- Se habilitó la edición de campos clave directamente en la tabla, sin necesidad de abrir un modal separado.

### Seguridad: Sistema de autenticación y control de acceso *(nuevo)*
- Se implementó un **sistema completo de login** con usuario y contraseña, sesión persistente y cierre de sesión.
- Se creó un **modelo de roles y permisos** por módulo: cada rol puede tener habilitadas en forma independiente las acciones Ver, Crear, Editar y Eliminar para cada sección de la aplicación (Dashboard, Taller, Venta, KPIs, Layout, Técnicos, Licencias, Administración).
- Se incorporó una sección de **Administración** desde la que usuarios con el permiso correspondiente pueden:
  - Crear, editar y eliminar usuarios (asignando rol, nombre y contraseña).
  - Crear, editar y eliminar roles con su matriz de permisos configurable.
- La barra de navegación se adapta automáticamente al rol del usuario: solo muestra las secciones a las que tiene acceso.
- Se implementó control de concurrencia optimista: si dos usuarios editan al mismo tiempo, el sistema detecta el conflicto y protege los datos sin pérdidas.

---

## 8 de junio

### Módulo: Taller — Historial de equipos *(nuevo)*
- Cada equipo ahora registra un **historial de movimientos**: cada cambio de estado (ingreso, pase a listo, entrega, etc.) queda guardado con fecha y usuario responsable.
- El historial es visible desde el detalle de cada equipo, ordenado cronológicamente.

### Módulo: Taller — Mejoras generales
- Se eliminó la barra de filtros superior en la vista de Taller para una interfaz más limpia; el filtrado se mantiene disponible a través de los controles existentes.
- Los indicadores de días transcurridos ahora se muestran en **color según antigüedad** (verde, ámbar, rojo), facilitando la identificación visual de equipos con mucho tiempo en el taller.
- Se extendió el tipo de dato del ID de equipo para soportar valores más grandes sin errores.
- Se agregó un ícono de descarga al botón de exportación Excel para mayor claridad.
- Se actualizó el ícono de la aplicación (favicon) con el logo del taller.

### Módulo: Licencias de personal *(nuevo)*
- Se desarrolló un módulo completo para la **gestión de licencias y francos del personal**, con las siguientes funcionalidades:
  - **Saldos por técnico:** seguimiento individual de saldos disponibles para Francos, Vacaciones y Examen/Estudio.
  - **Registro de licencias:** permite registrar ausencias indicando técnico, tipo, fecha de inicio, cantidad de días y observaciones; el saldo se descuenta automáticamente.
  - **Ajuste de saldos:** posibilidad de sumar días al saldo de un técnico (por ejemplo, al asignar francos del período) con registro del motivo.
  - **Disponibilidad del día:** indicador en tiempo real de qué técnicos están de licencia en la fecha actual.
  - **Historial completo:** tabla con todos los movimientos (licencias y ajustes), con filtros por técnico y tipo, columna de auditoría mostrando quién registró cada movimiento y a qué hora, y paginación configurable (10 / 25 / 50 / 100 registros por página).
- El módulo respeta el sistema de permisos: el acceso y cada acción (ver, registrar, ajustar, eliminar) se controlan por rol desde el panel de Administración.

---

## 9 de junio

### Módulo: Dashboard — Corrección de disponibilidad
- Se corrigió el indicador **"Técnicos libres"**: los técnicos que están de licencia hoy ya no figuran como disponibles.
- En la tarjeta de Técnicos del Dashboard se agregó un grupo **"De licencia"** (en ámbar) que identifica quiénes están ausentes, distinguiéndolos claramente de los que están libres y de los que tienen equipos asignados.

---

*Todos los cambios están desplegados en producción.*
