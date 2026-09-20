import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadConfig} from './config.mjs';
import {createLlmService,AppError} from './llm.mjs';
import {createCareAiService,RECORD_EXTRACT_BODY_LIMIT} from './care-ai.mjs';
export const root=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
const publicFiles=new Set(['/index.html','/styles.css','/app.mjs','/matching.mjs','/record-store.mjs','/data/doctors.json','/shared-ui.mjs','/portal.mjs','/portal.css','/downward.mjs','/downward.css','/guidance.mjs','/guidance.css']);
function send(res,status,value) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function readJson(req,limit=98304) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415,'JSON_REQUIRED','请求需要 JSON 格式。');
  let size=0;const chunks=[];
  for await (const chunk of req) {size+=chunk.length;if(size>limit)throw new AppError(413,'INPUT_TOO_LARGE','输入内容过长。');chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value || typeof value!=='object' || Array.isArray(value))throw Error();return value;}
  catch {throw new AppError(400,'INVALID_JSON','请求不是有效的 JSON 对象。');}
}
export async function createAppServer({config,fetchImpl=fetch}={}) {
  config ||= await loadConfig(root);
  const publicOrigin=config.publicOrigin?new URL(config.publicOrigin):null;
  const doctors=JSON.parse(await fs.readFile(path.join(root,'data/doctors.json'),'utf8'));
  const service=createLlmService({config,doctors,fetchImpl});
  const careService=createCareAiService({config,fetchImpl});
  const routes={'/api/match':service.match,'/api/chat':service.chat,'/api/record-extract':careService.extractRecord,'/api/alert-summary':careService.summarizeAlert};
  let active=0;let starts=[];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      // Accept the configured proxy origin only. Forwarded headers never grant access.
      const host=req.headers.host || '';
      const expectedOrigin=publicOrigin?.host===host?publicOrigin.origin:/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)?`http://${host}`:null;
      if (!expectedOrigin) throw new AppError(403,'FORBIDDEN_HOST','不接受此访问地址。');
      if (req.headers.origin && req.headers.origin!==expectedOrigin) throw new AppError(403,'FORBIDDEN_ORIGIN','不接受跨站请求。');
      const url=new URL(req.url,expectedOrigin);
      if (url.pathname==='/api/health' && req.method==='GET') return send(res,200,{service:'anzhen-referral-workspace',status:'ok'});
      if (url.pathname==='/api/config' && req.method==='GET') return send(res,200,{configured:Boolean(config.apiKey),provider:'kimi',model:config.model,maxCaseLength:5000});
      if (Object.hasOwn(routes,url.pathname)) {
        if(req.method!=='POST')throw new AppError(405,'METHOD_NOT_ALLOWED','请使用 POST。');
        const body=await readJson(req,url.pathname==='/api/record-extract'?RECORD_EXTRACT_BODY_LIMIT:98304);
        if(active>=2)throw new AppError(429,'LOCAL_BUSY','正在处理其他 AI 请求，请稍后重试。');
        const now=Date.now();starts=starts.filter(t=>now-t<60000);
        if(starts.length>=20)throw new AppError(429,'LOCAL_RATE_LIMIT','本地一分钟最多调用 20 次，请稍后重试。');
        starts.push(now);active++;
        const controller=new AbortController();
        const abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try {const result=await routes[url.pathname](body,controller.signal);if(!res.destroyed)send(res,200,result);}
        finally {active--;res.off('close',abort);}
        return;
      }
      if (!['GET','HEAD'].includes(req.method)) throw new AppError(405,'METHOD_NOT_ALLOWED','请求方法不支持。');
      const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
      if (!publicFiles.has(relative) && !/^\/assets\/doctors\/doctor-[a-z0-9-]+\.(?:png|jpg)$/.test(relative)) throw new AppError(404,'NOT_FOUND','文件不存在。');
      const target=await fs.realpath(path.join(root,relative));
      if (!target.startsWith(root+path.sep)) throw new AppError(404,'NOT_FOUND','文件不存在。');
      const content=await fs.readFile(target);
      res.writeHead(200,{'Content-Type':mime[path.extname(target)] || 'application/octet-stream'});res.end(req.method==='HEAD'?undefined:content);
    } catch(error) {
      if(res.destroyed || res.writableEnded)return;
      const status=error instanceof AppError?error.status:error.code==='ENOENT'?404:500;
      send(res,status,{error:{code:error instanceof AppError?error.code:status===404?'NOT_FOUND':'SERVER_ERROR',message:error instanceof AppError?error.message:status===404?'文件不存在。':'服务发生错误，请重试。'}});
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const config=await loadConfig(root);const server=await createAppServer({config});
    server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`端口 ${config.port} 已被占用，请停止旧服务或修改 .env 中 PORT。`:'启动失败，请检查本地端口和配置。');process.exitCode=1;});
    server.listen(config.port,'127.0.0.1',()=>console.log(`安贞医联转诊工作台：http://127.0.0.1:${config.port}\n智能服务${config.apiKey?'已就绪':'尚未配置，请完成服务端设置后重启'}。`));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
