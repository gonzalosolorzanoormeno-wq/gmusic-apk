import assert from 'node:assert/strict';
import {buildPlaylistDocx} from '../src/docx.js';
const bytes=buildPlaylistDocx({playlistName:'Lidika ñ',rows:[{title:'LUNA',artist:'Feid',album:'FERXXOCALIPSIS',status:'missing',status_label:'Falta'},{title:'Otra',artist:'Artista',album:'Álbum',status:'available',status_label:'Ya está'}],filter:'missing'});
assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b,'DOCX must be a ZIP/Open XML package');
const raw=new TextDecoder().decode(bytes);assert.match(raw,/\[Content_Types\]\.xml/);assert.match(raw,/word\/document\.xml/);assert.match(raw,/GMusic/);assert.match(raw,/Lidika/);assert.match(raw,/LUNA/);assert.doesNotMatch(raw,/>Otra</,'missing-only export should exclude available tracks from the document body');
console.log('✓ DOCX v3.4 structural tests OK');
