import { cleanTrackTitle, normalizeArtistKey, normalizeAlbumKey, splitArtistNames, buildMetadataCleanupPlan } from "../src/index.js";

function assert(condition, message){ if(!condition) throw new Error(`FALLO: ${message}`); }
assert(normalizeArtistKey(" FEID ") === normalizeArtistKey("Feid"), "FEID/Feid deben compartir clave");
assert(normalizeArtistKey("feid") === normalizeArtistKey("Feid"), "feid/Feid deben compartir clave");
assert(normalizeArtistKey("Mora") !== normalizeArtistKey("Morad"), "Mora y Morad deben ser distintos");
assert(normalizeAlbumKey(" FERXXOCALIPSIS ") === normalizeAlbumKey("Ferxxocalipsis"), "álbum debe normalizar espacios/case");
assert(cleanTrackTitle("LUNA [Official Audio]", "Feid") === "LUNA", "Official Audio debe eliminarse");
assert(cleanTrackTitle("CLASSY 101 - Visualizer", "Feid") === "CLASSY 101", "Visualizer debe eliminarse");
assert(cleanTrackTitle("FANTAXXIAS (Video Oficial)", "Feid") === "FANTAXXIAS", "Video Oficial debe eliminarse");
assert(cleanTrackTitle("Feid - LUNA (Official Video)", "Feid") === "LUNA", "artista repetido debe eliminarse");
assert(cleanTrackTitle("Audio", "Feid") === "Audio", "una palabra legítima sin contexto no debe desaparecer");
const split=splitArtistNames("SAIKO, Tito El Bambino, Feid");
assert(split.length===3 && split[2]==="Feid", "colaboradores deben separarse");
const fake=(id,artist,title,album="Sin álbum")=>({id,name:`${title}.mp3`,appProperties:{gmusic_track:"1",artist,title,album}});
const plan=buildMetadataCleanupPlan([
  fake("aaaaaaaaaaa","FEID","LUNA [Official Audio]","FERXXOCALIPSIS"),
  fake("bbbbbbbbbbb","Feid","CLASSY 101 - Visualizer","Ferxxocalipsis"),
  fake("ccccccccccc","Mora","512","ESTRELLAS Y YO")
]);
assert(plan.duplicate_artists.some(x=>x.key===normalizeArtistKey("Feid")), "debe detectar variantes FEID/Feid");
assert(!plan.duplicate_artists.some(x=>x.key===normalizeArtistKey("Mora") && x.variants.some(v=>/Morad/i.test(v.name))), "no debe mezclar Mora/Morad");
assert(plan.changes.some(x=>x.before.title.includes("Official Audio") && x.after.title==="LUNA"), "plan debe limpiar títulos");
console.log("✓ Metadata canonicalization/cleanup tests OK");
