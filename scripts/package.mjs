import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const output=path.join(dist,'anzhen-referral-workspace.zip');
const files=['README.md','package.json','.gitignore','index.html','styles.css','portal.css','downward.css','guidance.css','portal.mjs','downward.mjs','guidance.mjs','shared-ui.mjs','care-ai.mjs','care-ai.test.mjs','downward.test.mjs','guidance.test.mjs','app.mjs','matching.mjs','record-store.mjs','server.mjs','config.mjs','llm.mjs','matching.test.mjs','api.test.mjs','record-store.test.mjs','build-offline.mjs','data/doctors.json','data/asset-audit.json','启动工作台.command','启动工作台.bat'];
async function walk(relative){for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){const next=`${relative}/${entry.name}`;if(entry.isDirectory())await walk(next);else if(entry.isFile()&&!entry.name.startsWith('.'))files.push(next);}}
files.push('schedule-policy.mjs','referral-workflow.mjs','approval-ui.mjs','approval-ui.test.mjs','data-intake.mjs','attachments.mjs','attachment-store.mjs','data-intake.css','schedule-policy.test.mjs','referral-workflow.test.mjs','attachments.test.mjs','data-intake.test.mjs','attachment-store.test.mjs','config.test.mjs','workspace-store.mjs','workspace-store.test.mjs','shared-client.mjs','shared-client.test.mjs');
for(const dir of ['assets/doctors','docs','scripts','deploy'])await walk(dir);
const template=(await fs.readFile(path.join(root,'.env.example'),'utf8')).replace(/^(?:MOONSHOT_API_KEY|KIMI_API_KEY)=.*$/gm,'MOONSHOT_API_KEY=');
const entries=[];
for(const name of [...new Set(files)].sort())entries.push({name,data:await fs.readFile(path.join(root,name))});
entries.push({name:'.env',data:Buffer.from(template)},{name:'.env.example',data:Buffer.from(template)});
const manifest={version:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,packagedAt:new Date().toISOString(),configuration:'Packaged .env and .env.example contain no API key. Local .env is never read.',files:entries.map(e=>({file:e.name,bytes:e.data.length,sha256:createHash('sha256').update(e.data).digest('hex')}))};
entries.push({name:'MANIFEST.json',data:Buffer.from(JSON.stringify(manifest,null,2))});
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(buffer){let n=0xffffffff;for(const b of buffer)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
const local=[],central=[];let offset=0;
for(const entry of entries){
  const name=Buffer.from(`anzhen-referral-workspace/${entry.name}`);const zipped=deflateRawSync(entry.data);const crc=crc32(entry.data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(zipped.length,18);header.writeUInt32LE(entry.data.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,zipped);
  const index=Buffer.alloc(46);index.writeUInt32LE(0x02014b50,0);index.writeUInt16LE(0x0314,4);index.writeUInt16LE(20,6);index.writeUInt16LE(0x800,8);index.writeUInt16LE(8,10);index.writeUInt16LE(33,14);index.writeUInt32LE(crc,16);index.writeUInt32LE(zipped.length,20);index.writeUInt32LE(entry.data.length,24);index.writeUInt16LE(name.length,28);
  const mode=entry.name.endsWith('.command')?0o100755:entry.name==='.env'?0o100600:0o100644;index.writeUInt32LE((mode*65536)>>>0,38);index.writeUInt32LE(offset,42);central.push(index,name);offset+=header.length+name.length+zipped.length;
}
const directory=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await fs.mkdir(dist,{recursive:true});await fs.writeFile(output,Buffer.concat([...local,directory,end]));
console.log(JSON.stringify({output,files:entries.length,bytes:(await fs.stat(output)).size,apiKeyIncluded:false},null,2));
