import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const config=JSON.parse(await readFile(resolve(root,'bench.config.json'),'utf8'));
const expected={model:'00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',projector:'cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864',reranker:'22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48'};
for(const [name,want] of Object.entries(expected)){
 const hash=createHash('sha256');for await(const b of createReadStream(resolve(root,config[name])))hash.update(b);
 const actual=hash.digest('hex');if(actual!==want)throw new Error(`${name}: model hash differs from the recorded condition (${actual})`);
 console.log(`${name}: ${actual}`);
}
