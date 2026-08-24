# Catálogo de sagas y eventos Marvel

Este directorio separa los datos editoriales de la interfaz. `catalog.json`
contiene 170 eventos ordenados cronológicamente (1965–2027). Hay 169 órdenes
disponibles y un único anuncio futuro sin números publicados.

## Alcance editorial

No existe una lista oficial única, cerrada y universal de «todas las sagas
Marvel». La base v3 toma como índice reproducible la cronología de eventos de
Comic Book Reading Orders y la amplía con las guías oficiales de Marvel para
los eventos posteriores a esa cronología. Los órdenes de 2025–2026 se
contrastan además con guías especializadas cuando Marvel no publica una
secuencia lineal completa.

Se incluyen eventos globales, cruces de franquicia, miniseries-evento y arcos
con un orden documentable. Se excluyen variantes, facsímiles, reimpresiones sin
material narrativo nuevo y simples apariciones compartidas sin continuidad.

## Archivos y carga escalable

- `catalog.json`: metadatos ligeros para buscar y ordenar las 170 tarjetas.
- `events-1960s.json` … `events-2020s.json`: órdenes generados agrupados por
  década. Cada registro del catálogo usa `dataFile` + `dataKey`.
- `secret-wars-1984.json`, `infinity-gauntlet.json` y
  `secret-wars-2015.json`: órdenes curados manualmente con selección Esencial.

La interfaz almacena una sola promesa por paquete de década. Abrir varias
sagas de la misma década no vuelve a descargar ese archivo ni vuelve a cargar
la biblioteca principal.

## Contrato de datos

Cada elemento de `entries` contiene exclusivamente datos propios del orden:

- `issueId`: ID estable y real de la biblioteca principal;
- `order`: posición determinista y consecutiva;
- `section`: fase narrativa;
- `type`: `main` o `tie-in`;
- `importance`: `principal`, `essential` o `complete`.

No se duplican títulos, fechas, portadas ni enlaces de Marvel Unlimited. La UI
los obtiene del mismo cómic de la biblioteca, por lo que el progreso continúa
siendo el mismo `state.progress` de Lectura y Personajes.

`expectedCounts` cuenta referencias ya enlazadas y `targetCounts` el alcance
editorial documentado. Una referencia ausente o ambigua se conserva en
`unresolvedReferences`, con `referenceId` (o un `gcdIssueId` conocido), serie,
número, posición objetivo y motivo. Nunca recibe un `issueId` inventado.

## Política de los tres modos

- En los tres eventos curados, Principal, Esencial y Completo son selecciones
  editoriales independientes y documentadas.
- En la importación masiva, una miniserie central homónima inequívoca forma
  Principal; el resto entra en Completo.
- Esencial coincide deliberadamente con Principal hasta una futura curación
  manual. No se infiere importancia narrativa a partir del título.
- Cuando un crossover no tiene serie central inequívoca, su orden cruzado
  completo se considera Principal.

## Actualización reproducible

1. Ejecutar `npm run import:sagas` para descargar o reutilizar las fuentes,
   cruzar todas las referencias con los 51.002 números locales y regenerar los
   paquetes por década.
2. Revisar `artifacts/sagas/all-events-import-validation.{json,md}`.
3. Resolver únicamente coincidencias respaldadas; las dudosas deben permanecer
   documentadas.
4. Ejecutar `npm test` y `npm run validate:sagas`.

## Cobertura del lote 2026-08-24

- Catálogo: 170 eventos.
- Disponibles: 169.
- Referencias enlazadas: 5.384 / 5.532.
- Referencias ausentes o ambiguas documentadas: 148.
- Cómics únicos reutilizados: 5.339, repartidos en 943 series.
- Pendiente: *Star Wars/Marvel: Hope Assembles* (enero de 2027), todavía sin
  números publicados ni IDs reales en la biblioteca.

Los eventos en publicación conservan sus futuros capítulos como ausencias
explícitas. Esto afecta a *Avengers: Armageddon*, *DNX* y *Queen in Black*; al
actualizar la biblioteca basta con volver a ejecutar el importador.

## Informes

- [Importación masiva](../../../artifacts/sagas/all-events-import-validation.md)
- [Secret Wars (1984)](../../../artifacts/sagas/secret-wars-1984-validation.md)
- [Infinity Gauntlet (1991)](../../../artifacts/sagas/infinity-gauntlet-validation.md)
- [Secret Wars (2015)](../../../artifacts/sagas/secret-wars-2015-validation.md)
