// Isolated wheel-only runtime; mirrors and hash provenance are explicit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const work=resolve(root,'.data/experiments/agent-world-service/runtime');
mkdirSync(work,{recursive:true});
const index='https://pypi.tuna.tsinghua.edu.cn/simple/';
const pipURL='https://pypi.tuna.tsinghua.edu.cn/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl';
const pipHash='9655943313a94722b7774661c21049070f6bbb0a1516bf02f7c8d5d9201514cd';
const pipPath=resolve(work,'pip-25.3-py3-none-any.whl');
// Schannel cannot reach its revocation server on this host. Best-effort still
// verifies the TLS certificate; the wheel must additionally match the pinned hash.
if(!existsSync(pipPath))execFileSync('curl.exe',['--ssl-revoke-best-effort','--connect-timeout','5','--max-time','20','-sS','--fail',pipURL,'-o',pipPath],{windowsHide:true,timeout:25_000});
const bytes=readFileSync(pipPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'),pipHash);writeFileSync(pipPath,bytes);
const packages=['mcp==1.26.0','Django==4.2.26','channels==4.3.2','daphne==4.2.1',
  'whitenoise==6.11.0','django-cors-headers==4.9.0','aiohttp==3.13.3','numpy==2.2.6','wsproto==1.2.0'];
const wheelhouse=resolve(work,'wheels');mkdirSync(wheelhouse,{recursive:true});
const common=['--disable-pip-version-check','--isolated'];
const prior=existsSync(resolve(work,'runtime.json'))?JSON.parse(readFileSync(resolve(work,'runtime.json'),'utf8')):null;
const missing=prior?packages.filter(pin=>!prior.wheels.some(item=>item.name.toLowerCase().replaceAll('_','-')===pin.split('==')[0].toLowerCase()&&item.version===pin.split('==')[1])):packages;
const downloadArgs=[...common,'download','--only-binary=:all:','--dest',wheelhouse,
  '--timeout','12','--retries','0','--index-url',index,...(prior?['--no-deps']:[]),...missing];
const installArgs=[...common,'install','--no-index','--find-links',wheelhouse,'--no-compile','--no-warn-script-location',
  '--target',resolve(work,'site-packages'),'--upgrade','--report',resolve(work,'install-report.json'),...packages];
const script=`import sys\nsys.path.insert(0,${JSON.stringify(pipPath)})\nfrom pip._internal.cli.main import main\ncode=main(${JSON.stringify(downloadArgs)}) if ${missing.length} else 0\nif code: sys.exit(code)\nsys.exit(main(${JSON.stringify(installArgs)}))\n`;
writeFileSync(resolve(work,'pip-run.py'),script);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['SYSTEMROOT','WINDIR','TEMP','TMP'].includes(k.toUpperCase())));
const child=spawn(resolve(root,'.data/experiments/actual-ecommerce-noter/python/python.exe'),['-I','-B','-X','utf8',resolve(work,'pip-run.py')],{env,stdio:'inherit',windowsHide:true});
const code=await new Promise(done=>child.once('exit',done));assert.equal(code,0);
const report=JSON.parse(readFileSync(resolve(work,'install-report.json'),'utf8'));
const wheels=report.install.map(item=>{
  const filename=decodeURIComponent(new URL(item.download_info.url).pathname).split('/').at(-1);
  const hash=item.download_info.archive_info.hashes.sha256;
  assert.equal(createHash('sha256').update(readFileSync(resolve(wheelhouse,filename))).digest('hex'),hash);
  return {name:item.metadata.name,version:item.metadata.version,filename,sha256:hash};
});
writeFileSync(resolve(work,'runtime.json'),JSON.stringify({python:'3.12.10',index,
  hashOrigin:'TLS mirror index/download hashes; not an independently verified publisher signature',
  pip:{version:'25.3',url:pipURL,sha256:pipHash},wheels},null,2));
console.log(JSON.stringify({verifiedWheels:wheels.length}));
