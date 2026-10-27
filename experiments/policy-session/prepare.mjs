import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GitHubClient} from '../../packages/sensor-github/dist/index.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
if(existsSync(resolve(root,'.env'))) process.loadEnvFile(resolve(root,'.env'));
const client=new GitHubClient({token:process.env.GITHUB_TOKEN});
const specs=[
  ['jatechan/ai-data-extractor','df66cb083cf597edbedf49684f762581ce250f8e','extractors/claude_code.py','1a89e904de29fc96e28edbafdb23569597ec70cc'],
  ['jatechan/ai-data-extractor','df66cb083cf597edbedf49684f762581ce250f8e','extractors/codex.py','565ae4b032e4c0a0d91153c332cf7da2b6e3eb46'],
  ['jatechan/ai-data-extractor','df66cb083cf597edbedf49684f762581ce250f8e','extractors/common.py','8ef83163405df80524f0dfd87c49fc7cd1a0c52d'],
  ['jatechan/ai-data-extractor','df66cb083cf597edbedf49684f762581ce250f8e','LICENSE','1325f70f5ca04d53290b2552a5e9f7d99370c800'],
];
const files=[];
for(const [repository,commit,path,blob] of specs){
  // Fixed official API origin; the token never follows arbitrary README links.
  const file=await client.request(new URL(`https://api.github.com/repos/${repository}/contents/${path}?ref=${commit}`));
  const bytes=Buffer.from(file.content,'base64');
  const actual=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  assert.equal(file.sha,blob);assert.equal(actual,blob);
  const local=`.data/research/policy-session/vendor/ai-data-extractor/${path}`;
  mkdirSync(dirname(resolve(root,local)),{recursive:true});writeFileSync(resolve(root,local),bytes);
  files.push({repository,commit,path,blob,local});
  console.log(JSON.stringify({path,bytes:bytes.length,blob}));
}
writeFileSync(resolve(root,'.data/research/policy-session/files.json'),JSON.stringify(files,null,2));
