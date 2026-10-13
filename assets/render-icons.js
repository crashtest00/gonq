// Renders src-tauri/icons from the SVGs. Needs @resvg/resvg-js (not a repo dependency; install it in a scratch dir and adjust the require path).
// Usage: node assets/render-icons.js assets/gonq-logo-OUTLINE.svg assets/logo-micro.svg src-tauri/icons
// 16 and 24 come from MICRO; every other size is rendered from the outlined FULL logo at its own size.
const {Resvg}=require('/tmp/tools/node_modules/@resvg/resvg-js');
const fs=require('fs');
const [,, outline, micro, out]=process.argv;
const src={full:fs.readFileSync(outline),micro:fs.readFileSync(micro)};
const cache={};
function png(n){ // 16,24 from MICRO; else outlined FULL rendered at target size
  if(cache[n])return cache[n];
  const s=n<=24?src.micro:src.full;
  const r=new Resvg(s,{fitTo:{mode:'width',value:n}});
  const b=r.render().asPng(); if(!cache[n])cache[n]=b; return b;
}
const w=(f,b)=>fs.writeFileSync(out+'/'+f,b);
for(const n of [32,64,128,256,512]) { if(n==256)w('128x128@2x.png',png(n)); else if(n==512)w('icon.png',png(n)); else w(n+'x'+n+'.png',png(n)); }
for(const n of [30,44,71,89,107,142,150,284,310])w(`Square${n}x${n}Logo.png`,png(n));
w('StoreLogo.png',png(50));
// ico
const sizes=[16,24,32,48,64,256];
const hdr=Buffer.alloc(6+16*sizes.length); hdr.writeUInt16LE(1,2); hdr.writeUInt16LE(sizes.length,4);
let off=hdr.length; const imgs=[];
sizes.forEach((n,i)=>{const b=png(n),o=6+16*i;hdr[o]=n==256?0:n;hdr[o+1]=n==256?0:n;hdr.writeUInt16LE(1,o+4);hdr.writeUInt16LE(32,o+6);hdr.writeUInt32LE(b.length,o+8);hdr.writeUInt32LE(off,o+12);off+=b.length;imgs.push(b);});
w('icon.ico',Buffer.concat([hdr,...imgs]));
// icns
const ent=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]];
const parts=ent.map(([t,n])=>{const b=png(n),h=Buffer.alloc(8);h.write(t,0,'ascii');h.writeUInt32BE(b.length+8,4);return Buffer.concat([h,b]);});
const body=Buffer.concat(parts),h=Buffer.alloc(8);h.write('icns',0,'ascii');h.writeUInt32BE(body.length+8,4);
w('icon.icns',Buffer.concat([h,body]));
