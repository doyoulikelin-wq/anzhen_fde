import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const label='cn.anzhen.referral-workspace';
const domain=`gui/${process.getuid?.()}`;
const target=`${domain}/${label}`;
const support=path.join(os.homedir(),'Library/Application Support/AnzhenReferralWorkspace');
const current=path.join(support,'current');
const dataDirectory=path.join(support,'var');
const logs=path.join(os.homedir(),'Library/Logs/AnzhenReferralWorkspace');
const plist=path.join(os.homedir(),'Library/LaunchAgents',`${label}.plist`);
const metadataFile=path.join(support,'service.json');
const command=process.argv[2]||'install';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const launch=(args,optional=false)=>{
  try{return execFileSync('/bin/launchctl',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
  catch(error){if(optional)return null;throw new Error(`后台服务操作失败（${args[0]}）：${error.stderr?.toString().trim()||'请检查系统后台项目设置'}`);}
};
async function readOptional(file){try{return await fs.readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function linkTarget(){try{return await fs.readlink(current);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function metadata(){const text=await readOptional(metadataFile);return text?JSON.parse(text):null;}
async function withControlLock(operation){
  await fs.mkdir(support,{recursive:true,mode:0o700});
  const lock=path.join(support,'.service-control.lock');
  let handle;
  for(let attempt=0;attempt<2;attempt++){
    try{handle=await fs.open(lock,'wx',0o600);break;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const owner=Number((await readOptional(lock))?.trim());
      if(!Number.isInteger(owner)||owner<1)throw new Error('另一个服务管理操作正在启动，请稍后重试。');
      try{process.kill(owner,0);throw new Error('另一个服务管理操作正在执行，请等待完成后重试。');}
      catch(probe){if(probe.code!=='ESRCH')throw probe;}
      await fs.rm(lock,{force:true});
    }
  }
  if(!handle)throw new Error('服务管理正忙，请稍后重试。');
  await handle.writeFile(String(process.pid));
  try{return await operation();}finally{await handle.close();await fs.rm(lock,{force:true});}
}
async function healthy(port){
  try{const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});const body=await response.json();return response.ok&&body.service==='anzhen-referral-workspace'&&body.status==='ok';}
  catch{return false;}
}
async function waitHealthy(port){
  const deadline=Date.now()+35000;
  do{if(await healthy(port))return;await sleep(500);}while(Date.now()<deadline);
  throw new Error(`后台服务尚未恢复，请查看 ${logs} 中的日志。`);
}
async function portAvailable(port){
  return new Promise(resolve=>{const probe=net.createServer();probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});
}
async function waitPortAvailable(port){
  for(let attempt=0;attempt<20;attempt++){if(await portAvailable(port))return;await sleep(250);}
  throw new Error(`端口 ${port} 已被其他程序使用，未停止该程序。请先关闭之前手动启动的工作台，再运行本脚本。`);
}
async function replaceLink(destination){
  const temporary=path.join(support,`.current-${randomUUID()}`);
  await fs.symlink(destination,temporary);
  await fs.rename(temporary,current);
}
async function atomicWrite(file,text,mode=0o600){
  const temporary=`${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary,text,{mode});await fs.rename(temporary,file);
}
async function nodePath(){
  for(const candidate of [...new Set(['/opt/homebrew/bin/node','/usr/local/bin/node',process.execPath])]){
    try{await fs.access(candidate,fs.constants.X_OK);const version=execFileSync(candidate,['--version'],{encoding:'utf8'});if(Number(version.trim().slice(1).split('.')[0])>=22)return candidate;}catch{}
  }
  throw new Error('需要 Node.js 22 或以上版本。');
}
function makePlist(binary,port,release){
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${xml(binary)}</string><string>${xml(path.join(release,'server.mjs'))}</string></array>
  <key>WorkingDirectory</key><string>${xml(release)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>NODE_ENV</key><string>production</string><key>PORT</key><string>${port}</string><key>DATA_DIR</key><string>${xml(dataDirectory)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ExitTimeOut</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(path.join(logs,'server.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs,'server-error.log'))}</string>
</dict></plist>
`;
}
async function prepareRelease(){
  const release=path.join(support,'releases',`${new Date().toISOString().replaceAll(':','-')}-${randomUUID().slice(0,8)}`);
  await fs.mkdir(release,{recursive:true,mode:0o700});
  const files=['index.html','styles.css','portal.css','downward.css','guidance.css','app.mjs','portal.mjs','downward.mjs','guidance.mjs','shared-ui.mjs','shared-client.mjs','care-ai.mjs','matching.mjs','record-store.mjs','workspace-store.mjs','server.mjs','config.mjs','llm.mjs','package.json','data/doctors.json'];
  try{
    for(const file of files){const destination=path.join(release,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(root,file),destination);}
    await fs.cp(path.join(root,'assets/doctors'),path.join(release,'assets/doctors'),{recursive:true});
    await fs.copyFile(path.join(root,'.env'),path.join(release,'.env'));await fs.chmod(path.join(release,'.env'),0o600);
    execFileSync(await nodePath(),['--check',path.join(release,'server.mjs')],{stdio:'pipe'});
    return release;
  }catch(error){await fs.rm(release,{recursive:true,force:true});throw error;}
}
async function install(){
  // Read configuration inside the process; keys are never printed or written to the plist.
  const config=await loadConfig(root,{});
  for(const dir of [support,dataDirectory,logs,path.dirname(plist)])await fs.mkdir(dir,{recursive:true,mode:0o700});
  await fs.chmod(support,0o700);await fs.chmod(dataDirectory,0o700);await fs.chmod(logs,0o700);
  const old={link:await linkTarget(),plist:await readOptional(plist),metadata:await readOptional(metadataFile),loaded:launch(['print',target],true)!==null};
  const release=await prepareRelease();const binary=await nodePath();
  let changed=false;
  try{
    if(old.loaded)launch(['bootout',target]);
    await waitPortAvailable(config.port);
    await replaceLink(release);changed=true;
    await atomicWrite(plist,makePlist(binary,config.port,release));
    execFileSync('/usr/bin/plutil',['-lint',plist],{stdio:'pipe'});
    for(const name of ['server.log','server-error.log']){
      const file=path.join(logs,name);try{if((await fs.stat(file)).size>2*1024*1024)await fs.rename(file,file+'.1');}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    launch(['enable',target]);launch(['bootstrap',domain,plist]);
    await waitHealthy(config.port);
    await atomicWrite(metadataFile,JSON.stringify({label,url:`http://127.0.0.1:${config.port}/`,port:config.port,installedAt:new Date().toISOString(),source:root,release,node:binary},null,2));
    console.log(`后台服务已启动：http://127.0.0.1:${config.port}/\n关闭终端后仍可使用；登录后自动启动，进程退出后自动恢复。\n修改项目文件或 .env 后，再次运行本启动脚本即可更新。`);
  }catch(error){
    if(changed){
      launch(['bootout',target],true);
      if(old.link)await replaceLink(old.link);else await fs.rm(current,{force:true});
      if(old.plist)await atomicWrite(plist,old.plist);else await fs.rm(plist,{force:true});
      if(old.metadata)await atomicWrite(metadataFile,old.metadata);else await fs.rm(metadataFile,{force:true});
    }
    if(old.loaded&&old.plist){launch(['enable',target],true);launch(['bootstrap',domain,plist],true);}
    await fs.rm(release,{recursive:true,force:true});
    throw error;
  }
  if(process.argv.includes('--open')){
    try{execFileSync('/usr/bin/open',[`http://127.0.0.1:${config.port}/`]);}
    catch{console.log(`后台服务正常，浏览器未能自动打开；请手动访问 http://127.0.0.1:${config.port}/。`);}
  }
}
async function status(){
  const saved=await metadata();const loaded=launch(['print',target],true);const port=saved?.port||4173;
  const ok=await healthy(port);const pid=Number(loaded?.match(/^\s*pid = (\d+)/m)?.[1])||null;
  let configured=false;
  if(ok){try{const response=await fetch(`http://127.0.0.1:${port}/api/config`,{signal:AbortSignal.timeout(1500)});configured=Boolean((await response.json()).configured);}catch{}}
  console.log(JSON.stringify({installed:Boolean(saved),managed:Boolean(loaded),pid,healthy:ok,configured,url:saved?.url||`http://127.0.0.1:${port}/`,runtimeDirectory:current,dataDirectory,logDirectory:logs},null,2));
  if(!loaded||!ok)process.exitCode=1;
}
async function stop(){
  launch(['disable',target]);
  if(launch(['print',target],true)!==null)launch(['bootout',target]);
  console.log('后台服务已停止，自动启动已暂停。再次运行启动工作台.command 可恢复；已保存转诊记录不受影响。');
}
try{
  if(process.platform!=='darwin')throw new Error('此后台管理脚本适用于 macOS；其它系统可使用 npm start。');
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('请安装 Node.js 22 或更高版本。');
  if(['install','start','restart'].includes(command))await withControlLock(install);
  else if(command==='status')await status();
  else if(command==='stop')await withControlLock(stop);
  else throw new Error('支持的操作：install、start、restart、status、stop。');
}catch(error){console.error(error.message);process.exitCode=1;}
