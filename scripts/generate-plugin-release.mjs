import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
export async function generatePluginRelease(root=ROOT) {
  const manifest=JSON.parse(await readFile(resolve(root,'plugin-releases/current.json'),'utf8'));
  if(!/^0\.[0-9]+\.[0-9]+$/.test(manifest.version)||
     !/^mterm-chatgpt-v[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$/.test(manifest.file)||
     manifest.file!==`mterm-chatgpt-v${manifest.version}.tar.gz`||
     !/^[a-f0-9]{64}$/.test(manifest.sha256))throw new Error('Invalid private plugin release manifest');
  const archive=await readFile(resolve(root,'plugin-releases',manifest.file));
  if(archive.length<100||archive.length>1048576||archive[0]!==0x1f||archive[1]!==0x8b)throw new Error('Invalid private plugin archive');
  const digest=createHash('sha256').update(archive).digest('hex');
  if(digest!==manifest.sha256)throw new Error('Private plugin release archive hash differs from pinned manifest');
  const release={version:manifest.version,file:manifest.file,sha256:digest,bytes:archive.length,base64:archive.toString('base64')};
  await writeFile(resolve(root,'src/plugin-release.generated.js'),`// Generated from the pinned owner-only plugin release archive. Never place credentials here.\nexport const PLUGIN_RELEASE = ${JSON.stringify(release)};\n`);
  return {version:release.version,bytes:release.bytes,sha256:release.sha256};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await generatePluginRelease()));
}
