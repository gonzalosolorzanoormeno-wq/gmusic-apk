const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function u16(n){return [n & 255,(n>>>8)&255];}
function u32(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];}
function concat(chunks){let total=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(total),p=0;for(const c of chunks){out.set(c,p);p+=c.length;}return out;}
function zipStore(files){
  const local=[],central=[];let offset=0;
  for(const [name,content] of Object.entries(files)){
    const nameBytes=encoder.encode(name);const data=typeof content==='string'?encoder.encode(content):content;const crc=crc32(data);
    const lh=new Uint8Array([80,75,3,4,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),0,0]);
    local.push(lh,nameBytes,data);
    const ch=new Uint8Array([80,75,1,2,20,0,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(offset)]);
    central.push(ch,nameBytes);offset+=lh.length+nameBytes.length+data.length;
  }
  const centralBytes=concat(central);const localBytes=concat(local);const count=Object.keys(files).length;
  const end=new Uint8Array([80,75,5,6,0,0,0,0,...u16(count),...u16(count),...u32(centralBytes.length),...u32(localBytes.length),0,0]);
  return concat([localBytes,centralBytes,end]);
}
function xml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function paragraph(text,{bold=false,size=22}={}){return `<w:p><w:r><w:rPr>${bold?'<w:b/>':''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;}
function cell(text,{bold=false,width=2400}={}){return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr>${bold?'<w:b/>':''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p></w:tc>`;}
function table(rows){
  const header=['N.º','Canción','Artista','Álbum','Estado'];
  const tr=(cols,head=false)=>`<w:tr>${cell(cols[0],{bold:head,width:700})}${cell(cols[1],{bold:head,width:2800})}${cell(cols[2],{bold:head,width:2200})}${cell(cols[3],{bold:head,width:2400})}${cell(cols[4],{bold:head,width:1500})}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8B8B8"/><w:left w:val="single" w:sz="4" w:color="B8B8B8"/><w:bottom w:val="single" w:sz="4" w:color="B8B8B8"/><w:right w:val="single" w:sz="4" w:color="B8B8B8"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/></w:tblBorders></w:tblPr>${tr(header,true)}${rows.map((r,i)=>tr([String(i+1),r.title||'',r.artist||'',r.album||'',r.status_label||r.status||''])).join('')}</w:tbl>`;
}
export function buildPlaylistDocx({playlistName='Playlist',playlistUrl='',analyzedAt=new Date().toISOString(),rows=[],summary=null,filter='all'}={}){
  const filtered=(filter==='missing'?rows.filter(r=>r.status==='missing'):filter==='review'?rows.filter(r=>r.status==='review'):rows).map(r=>filter==='missing'?{...r,status_label:'☐ Falta'}:r);
  const counts=summary||{total:rows.length,available:rows.filter(r=>r.status==='available').length,missing:rows.filter(r=>r.status==='missing').length,review:rows.filter(r=>r.status==='review').length};
  const date=String(analyzedAt||'').slice(0,10);
  const body=[paragraph('GMusic – Análisis de Playlist',{bold:true,size:34}),paragraph(`Playlist: ${playlistName}`,{bold:true,size:26}),paragraph(`Fecha del análisis: ${date}`),...(playlistUrl?[paragraph(`Fuente Spotify: ${playlistUrl}`)]:[]),paragraph(`Total: ${counts.total||0} · Disponibles: ${counts.available||0} · Faltantes: ${counts.missing||0} · Revisar: ${counts.review||0}`),paragraph(filter==='missing'?'Listado: solo canciones faltantes':filter==='review'?'Listado: canciones para revisar':'Listado: todas las canciones',{bold:true}),table(filtered),paragraph(''),paragraph(`Resumen final — Total: ${counts.total||0} | Disponibles: ${counts.available||0} | Faltantes: ${counts.missing||0} | Revisar: ${counts.review||0}`,{bold:true})].join('');
  const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="850" w:bottom="1000" w:left="850"/></w:sectPr></w:body></w:document>`;
  const types=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const core=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(`GMusic - ${playlistName}`)}</dc:title><dc:creator>GMusic</dc:creator><cp:lastModifiedBy>GMusic</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${xml(analyzedAt)}</dcterms:created></cp:coreProperties>`;
  const app=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>GMusic</Application></Properties>`;
  return zipStore({'[Content_Types].xml':types,'_rels/.rels':rels,'word/document.xml':document,'word/_rels/document.xml.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>','docProps/core.xml':core,'docProps/app.xml':app});
}
