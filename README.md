# Marvel · Orden de Lectura

PWA de lectura Marvel con una única biblioteca y progreso compartido entre
Lectura, Personajes y Sagas.

La sección Sagas incluye un catálogo cronológico de 170 eventos (1965–2027):
169 órdenes disponibles, 5.384 referencias enlazadas por `issueId` real y 148
ausencias o ambigüedades documentadas. Los datos generados se agrupan por
década para que el catálogo pueda crecer sin duplicar cómics ni cargar cientos
de archivos individuales.

```bash
npm test
npm run validate:sagas
npm run build
```

Para regenerar en bloque los órdenes desde sus fuentes documentadas:

```bash
npm run import:sagas
```

El despliegue se sirve mediante Cloudflare Worker; la compilación prepara la
PWA, su Service Worker y todos los paquetes de sagas necesarios para uso
offline.
