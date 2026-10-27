import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve4 } from 'node:dns/promises';
import { get } from 'node:https';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, '.data/experiments/actual-ecommerce-noter/python');
const packages = [['requests','2.32.5'],['urllib3','2.5.0'],['charset-normalizer','3.4.4'],['idna','3.11'],['certifi','2025.10.5']];
const wheels = [];
const prior = existsSync(resolve(directory,'runtime.json')) ? JSON.parse(readFileSync(resolve(directory,'runtime.json'),'utf8')) : null;
// This network reaches only some of PyPI's DNS addresses. Keep the original
// hostname/SNI and certificate verification, and race the published IPv4 routes.
async function download(url) {
  const target=new URL(url); assert.ok(['pypi.org','files.pythonhosted.org'].includes(target.hostname));
  const addresses=await resolve4(target.hostname); const stop=new AbortController();
  const attempts=addresses.map((address)=>new Promise((done,reject)=>{
    const request=get(target,{family:4,signal:AbortSignal.any([stop.signal,AbortSignal.timeout(10_000)]),lookup:(_name,options,callback)=>options.all?callback(null,[{address,family:4}]):callback(null,address,4)},(response)=>{
      if(response.statusCode!==200){response.resume();reject(new Error(`HTTP ${response.statusCode}`));return;}
      const chunks=[];let length=0;
      response.on('data',(data)=>{length+=data.length;if(length>3*1024*1024)request.destroy(new Error('Oversized wheel response'));else chunks.push(data);});
      response.on('end',()=>done(Buffer.concat(chunks)));response.on('error',reject);
    });request.on('error',reject);
  }));
  try{return await Promise.any(attempts);}finally{stop.abort();await Promise.allSettled(attempts);}
}
for (const [name, version] of packages) {
  const cached=prior?.wheels?.find((item)=>item.name===name&&item.version===version);
  if(cached&&existsSync(resolve(directory,`${cached.filename}.zip`))){
    assert.equal(createHash('sha256').update(readFileSync(resolve(directory,`${cached.filename}.zip`))).digest('hex'),cached.sha256);
    wheels.push(cached);console.log(`Verified cached ${name} ${version}`);continue;
  }
  const metadata = JSON.parse((await download(`https://pypi.org/pypi/${name}/${version}/json`)).toString('utf8'));
  const options = metadata.urls.filter((item) => item.packagetype === 'bdist_wheel' && item.filename.endsWith('-py3-none-any.whl'));
  assert.equal(options.length, 1); const wheel = options[0];
  const target = resolve(directory, `${wheel.filename}.zip`);
  let bytes = existsSync(target) ? readFileSync(target) : null;
  if (!bytes) bytes=await download(wheel.url);
  const sha256 = createHash('sha256').update(bytes).digest('hex'); assert.equal(sha256, wheel.digests.sha256);
  writeFileSync(target, bytes); wheels.push({ name, version, filename: wheel.filename, url: wheel.url, sha256 });
  console.log(`Verified ${name} ${version}`);
}
writeFileSync(resolve(directory,'runtime.json'), JSON.stringify({ python: { version:'3.12.10',url:'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',sha256:'4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3',hashOrigin:'Pinned observed download hash; not a separately verified publisher signature'}, wheels },null,2));
