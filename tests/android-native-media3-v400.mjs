import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../public/native-audio-bridge.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../android-overrides/android/app/src/main/java/com/gmusic/app/GMusicPlaybackService.java', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../android-overrides/android/app/src/main/java/com/gmusic/app/GMusicAudioPlugin.java', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../android-overrides/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const deps = fs.readFileSync(new URL('../android-overrides/media3-dependencies.gradle', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/build-first-apk.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const checks = [
  [app.includes('syncNativeQueue'), 'app.js debe sincronizar una cola nativa'],
  [app.includes('/stream`,NATIVE_API_ORIGIN'), 'la cola nativa debe usar stream autenticado estable'],
  [app.includes('state.sessionToken = String(data.session_token || "")'), 'login debe capturar el token firmado'],
  [bridge.includes('setQueue:'), 'bridge debe exponer setQueue'],
  [bridge.includes('onTrackChanged:'), 'bridge debe exponer trackChanged'],
  [service.includes('extends MediaSessionService'), 'servicio debe usar MediaSessionService'],
  [service.includes('new ExoPlayer.Builder'), 'servicio debe usar ExoPlayer'],
  [service.includes('Authorization'), 'servicio debe enviar Bearer a streams autenticados'],
  [plugin.includes('setMediaItems(mediaItems'), 'plugin debe entregar la playlist completa a Android'],
  [manifest.includes('FOREGROUND_SERVICE_MEDIA_PLAYBACK'), 'manifest debe declarar mediaPlayback'],
  [manifest.includes('androidx.media3.session.MediaSessionService'), 'manifest debe anunciar MediaSessionService'],
  [deps.includes('media3-exoplayer'), 'Gradle debe incluir media3-exoplayer'],
  [deps.includes('media3-session'), 'Gradle debe incluir media3-session'],
  [deps.includes('1.10.1'), 'Media3 debe usar la versión estable fijada'],
  [index.includes('native-audio-bridge.js'), 'index debe cargar el bridge antes de app.js'],
  [pkg.devDependencies?.['@capacitor/core'] === '6.1.2', 'Capacitor core debe quedar fijado en 6.1.2'],
  [pkg.devDependencies?.['@capacitor/cli'] === '6.1.2', 'Capacitor CLI debe quedar fijado en 6.1.2'],
  [pkg.devDependencies?.['@capacitor/android'] === '6.1.2', 'Capacitor Android debe quedar fijado en 6.1.2'],
  [workflow.includes('platforms;android-36'), 'workflow debe instalar Android API 36'],
  [workflow.includes('com.android.tools.build:gradle:8.10.1'), 'workflow debe usar AGP compatible con API 36'],
  [workflow.includes('node_modules/@capacitor/android/capacitor/build.gradle'), 'workflow debe alinear el AGP interno de Capacitor'],
  [workflow.includes('gradle-8.11.1-bin.zip'), 'workflow debe usar Gradle 8.11.1'],
  [workflow.includes('compileSdkVersion = 36'), 'workflow debe compilar contra API 36 para Media3 1.10.1'],
  [workflow.includes('targetSdkVersion = 35'), 'workflow debe mantener targetSdk 35'],
  [workflow.includes('minSdkVersion = 23'), 'workflow debe subir minSdk a 23 para Media3 actual'],
  [workflow.includes('versionCode 40000'), 'workflow debe fijar versionCode de GMusic v4'],
  [workflow.includes('versionName \"4.0.0\"'), 'workflow debe fijar versionName 4.0.0'],
  [workflow.includes('GMusic-v4.0-native.apk'), 'workflow debe generar el APK nativo v4'],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(message);
}
console.log('Android native Media3 v4.0 preflight checks: OK');
