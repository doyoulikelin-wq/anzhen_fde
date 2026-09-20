import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../config.mjs';
import {createLlmService} from '../llm.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=await loadConfig(root);
if(!config.apiKey){console.error('尚未配置密钥。请填写 .env 中 MOONSHOT_API_KEY；未发送网络请求。');process.exit(1);}
try {
  const response=await fetch(`${config.baseURL}/models`,{headers:{Authorization:`Bearer ${config.apiKey}`},signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw new Error(`Kimi 连接检查返回 HTTP ${response.status}，请核对密钥、账户和平台地域。`);
  const data=await response.json();
  if(!data.data?.some(m=>m.id===config.model))throw new Error(`当前账户模型列表中未找到 ${config.model}。`);
  console.log(`Kimi 连接成功；账户模型列表包含 ${config.model}。未执行生成请求。`);
  if(process.argv.includes('--live')){
    const doctors=JSON.parse(await fs.readFile(path.join(root,'data/doctors.json'),'utf8'));
    const service=createLlmService({config,doctors});
    const caseText='虚拟患者，女，67岁，反复心悸6个月，动态心电图提示阵发性房颤，目前生命体征平稳，无胸痛，拟转诊进行电生理和消融评估。';
    const match=await service.match({caseText});
    const chat=await service.chat({caseText,messages:[{role:'user',content:'匹配分代表什么？排班是否真实？'}]});
    console.log(JSON.stringify({liveCheck:true,model:config.model,valid:match.analysis.valid,matched:match.ranked.length,topScore:match.ranked[0]?.score,answer:chat.answer},null,2));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
