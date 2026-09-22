import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=file=>fs.readFile(path.join(root,file),'utf8');
const template=await read('index.html');
const doctors=JSON.parse(await read('data/doctors.json'));
for(const d of doctors){const buffer=await fs.readFile(path.join(root,d.photo));d.photo=`data:image/png;base64,${buffer.toString('base64')}`;d.profile={officialClinics:d.profile?.officialClinics||[]};}
const safeJson=JSON.stringify(doctors).replaceAll('<','\\u003c');
const modules=['matching.mjs','schedule-policy.mjs','record-store.mjs','referral-workflow.mjs','shared-client.mjs','shared-ui.mjs','attachments.mjs','data-intake.mjs','approval-ui.mjs','portal.mjs','downward.mjs','guidance.mjs'];
function rewriteImports(source){return source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?\s*$/gm,(_,names,file)=>`const {${names.replace(/\s+as\s+/g,':')}}=offlineModules[${JSON.stringify(file)}];`);}
let script='const offlineModules={};\n';
for(const file of modules){
  const source=await read(file);
  const names=[...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(m=>m[1]);
  const compiled=rewriteImports(source.replace(/^export\s+/gm,''));
  script+=`offlineModules[${JSON.stringify(file)}]=(()=>{\n${compiled}\nreturn {${names.join(',')}};\n})();\n`;
}
script+=rewriteImports(await read('app.mjs'));
let html=template;
for(const file of ['styles.css','portal.css','downward.css','guidance.css','data-intake.css']){
  const css=await read(file);
  html=html.replace(`<link rel="stylesheet" href="${file}">`,()=>`<style>${css}</style>`);
}
html=html.replace('<script type="module" src="app.mjs"></script>',()=>`<script>window.__OFFLINE_DEMO__=true;window.__DOCTOR_DATA__=${safeJson};</script><script type="module">${script.replaceAll('</script','<\\/script')}</script>`);
const output=path.join(root,'安贞医联转诊工作台.html');
await fs.writeFile(output,html);
console.log(JSON.stringify({output,doctors:doctors.length,bytes:Buffer.byteLength(html)}));
