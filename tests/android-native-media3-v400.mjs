import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../public/native-audio-bridge.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../android-overrides/android/app/src/main/java/com/gmusic/app/GMusicPlaybackService.java', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../android-overrides/android/app/src/main/java/com/gmusic/app/GMusicAudioPlugin.java', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../android-overrides/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const deps = fs.readFileSync(new URL('../android-overrides/media3-dependencies.gradle', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/build-first-apk.yml', import.meta.url), 'utf8');

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
  [deps.includes('media3-session'), 'Gradle debe incluir media3-session'],
  [deps.includes('1.10.1'), 'Media3 debe usar la versión estable fijada'],
  [index.includes('native-audio-bridge.js'), 'index debe cargar el bridge antes de app.js'],
  [workflow.includes('com.android.tools.build:gradle:8.6.1'), 'workflow debe usar AGP compatible con API 35'],
  [workflow.includes('minSdkVersion = 23'), 'workflow debe subir minSdk a 23 para Media3 actual'],
  [workflow.includes('GMusic-v4.0-native.apk'), 'workflow debe generar el APK nativo v4'],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(message);
}
console.log('Android native Media3 v4.0 static checks: OK');
