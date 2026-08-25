# APK Android

Aplicación Android mínima para **Marvel · Orden de Lectura**.

La APK carga la versión de producción desde:

`https://marvel-orden-lectura.pokeapps.workers.dev/`

El WebView mantiene cookies, IndexedDB/DOM storage y caché propios de la aplicación. Los enlaces externos salen al sistema Android y los enlaces `intent://` usados por Marvel Unlimited se entregan directamente a la app `com.marvel.unlimited` cuando está instalada.

## Compilar

Requisitos: JDK 17, Android SDK 35 y Gradle 8.9.

```bash
gradle -p android-app :app:assembleDebug
```

Salida:

`android-app/app/build/outputs/apk/debug/app-debug.apk`

La GitHub Action `Android APK` genera además un artefacto llamado `Marvel-Orden-de-Lectura-APK`.
