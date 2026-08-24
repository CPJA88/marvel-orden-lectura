# Catálogo de sagas y eventos Marvel

Este directorio separa el catálogo de eventos de la interfaz. `catalog.json`
contiene 170 registros cronológicos (1965–2027) y cada evento disponible apunta
a un archivo de datos propio.

## Alcance editorial

No existe una lista oficial única y cerrada de «todas las sagas Marvel». La
base v2 combina:

- la cronología de eventos de Comic Book Reading Orders;
- las guías y páginas de series de Marvel para confirmar el alcance editorial;
- una auditoría secundaria de crossovers y anuncios recientes.

Se incluyen eventos globales, cruces de franquicia, miniseries-evento y arcos
con un orden de lectura documentable. Se excluyen variantes, facsímiles,
reimpresiones sin material narrativo nuevo y simples apariciones compartidas
sin continuidad narrativa.

## Contrato de un evento disponible

Cada entrada de `entries` referencia exclusivamente el `issueId` estable de
la biblioteca principal. Los títulos y números pueden documentarse en notas,
pero nunca sustituyen al identificador usado por el progreso.

Campos obligatorios por entrada:

- `issueId`: ID real de la biblioteca;
- `order`: posición determinista y consecutiva;
- `section`: fase narrativa;
- `type`: `main` o `tie-in`;
- `importance`: `principal`, `essential` o `complete`.

`expectedCounts` describe las referencias enlazadas y `targetCounts` el
alcance editorial objetivo. Si un original no existe en la biblioteca, se
registra en `unresolvedReferences` con su `gcdIssueId`, posición prevista y
motivo. Nunca se reemplaza por una reimpresión para ocultar el hueco.

## Flujo para añadir una saga

1. Contrastar la lista de números con al menos una fuente editorial u oficial
   y una fuente de orden de lectura cuando el orden sea discutible.
2. Cruzar cada número con la biblioteca extraída y conservar solo su
   `issueId` real.
3. Crear `<id>.json`, documentar fuentes y decisiones editoriales.
4. Ejecutar `npm test` y `npm run validate:sagas`.
5. Cambiar el registro del catálogo de `planned` a `available` y añadir
   `dataFile`.

## Cobertura actual

- Secret Wars (1984): 57 / 57 referencias enlazadas.
- Infinity Gauntlet (1991): 49 / 51 referencias enlazadas; faltan los dos
  originales de *The Thanos Quest* (1990).
- Secret Wars (2015): 264 / 264 referencias enlazadas.

El resto del catálogo permanece en `planned` hasta que su orden y sus IDs
superen la misma validación.

## Informes de validación

- [Catálogo v2](../../../artifacts/sagas/catalog-v2-validation.md)
- [Secret Wars (1984)](../../../artifacts/sagas/secret-wars-1984-validation.md)
- [Infinity Gauntlet (1991)](../../../artifacts/sagas/infinity-gauntlet-validation.md)
- [Secret Wars (2015)](../../../artifacts/sagas/secret-wars-2015-validation.md)
