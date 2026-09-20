import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
if (Number(process.versions.node.split('.')[0])<22) {console.error('请安装 Node.js 22 或更高版本。');process.exit(1);}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {await fs.copyFile(path.join(root,'.env.example'),path.join(root,'.env'),1);await fs.chmod(path.join(root,'.env'),0o600);console.log('已创建 .env，请填入 MOONSHOT_API_KEY。');}
catch(error) {if(error.code!=='EEXIST')throw error;console.log('使用现有 .env；不会覆盖密钥。');}
