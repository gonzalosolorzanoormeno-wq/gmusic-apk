import assert from 'node:assert/strict';
import {scoreDjTrack, chooseDjTrack, djGenreBucket} from '../public/dj-engine.js';
const tracks=[
 {id:'a',title:'A',artist:'Feid',genre:'Reggaeton'},
 {id:'b',title:'B',artist:'Artist B',genre:'Ambient'},
 {id:'c',title:'C',artist:'Artist C',genre:'Pop'}
];
const base={currentId:'c',stats:{a:10,b:1,c:5},favoriteIds:new Set(['b']),recentIds:[],recentArtists:[],feedback:{}};
assert.equal(djGenreBucket(tracks[0]),'energy');
assert.equal(djGenreBucket(tracks[1]),'chill');
assert.ok(scoreDjTrack(tracks[0],{...base,mode:'energy'})>scoreDjTrack(tracks[1],{...base,mode:'energy'}));
assert.ok(scoreDjTrack(tracks[1],{...base,mode:'chill'})>scoreDjTrack(tracks[0],{...base,mode:'chill'}));
assert.ok(scoreDjTrack(tracks[1],{...base,mode:'favorites'})>scoreDjTrack(tracks[0],{...base,mode:'favorites'}));
const recentScore=scoreDjTrack(tracks[0],{...base,mode:'taste',recentIds:['a']});
const freshScore=scoreDjTrack(tracks[0],{...base,mode:'taste',recentIds:[]});
assert.ok(recentScore<freshScore);
const picked=chooseDjTrack(tracks,{...base,mode:'favorites'},()=>0);
assert.ok(picked && picked.id!=='c');
console.log('dj v3.5: OK');
