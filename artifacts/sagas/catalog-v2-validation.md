# Validación del catálogo de sagas v2

Fecha de corte: 24 de agosto de 2026.

| Comprobación | Resultado |
| --- | ---: |
| Eventos catalogados | 170 |
| Intervalo cronológico | 1965–2027 |
| Eventos disponibles | 3 |
| Eventos preparados para implementación | 167 |
| Identificadores de evento duplicados | 0 |
| Archivos de datos duplicados | 0 |
| Orden cronológico determinista | Correcto |

## Alcance

No existe una taxonomía oficial histórica única que equivalga a «todas las sagas Marvel». El catálogo v2 adopta un alcance reproducible: eventos globales, cruces de franquicia, miniseries-evento y arcos con orden de lectura documentable.

La base combina la [cronología de eventos de Comic Book Reading Orders](https://comicbookreadingorders.com/marvel/event-timeline/) con las [guías oficiales de Marvel](https://www.marvel.com/comics/guides). Los eventos anunciados para 2026 y 2027 se incorporan desde sus páginas oficiales, pero permanecen en `planned` mientras sus órdenes no estén cerrados o no puedan cruzarse con la biblioteca.

## Implementación incremental

Cada evento del catálogo posee un ID estable, año, título, estado y procedencia. Pasarlo a `available` solo exige añadir un archivo de datos validado y su `dataFile`; la interfaz no necesita cambios adicionales. Los datos se descargan al abrir la saga y el cálculo de progreso se realiza contra el mismo `state.progress` global.

Resultado: catálogo escalable preparado; tres órdenes completas o auditadas disponibles y 167 registros pendientes de vinculación editorial.
