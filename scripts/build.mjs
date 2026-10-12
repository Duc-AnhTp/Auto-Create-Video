import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
export function buildProject(root = resolve(import.meta.dirname, '..'), execute = (script,args) => {
  const result=spawnSync(process.execPath,[script,...args],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`BUILD_FAILED: ${script} (${result.status})`);
}) {
  const output=resolve(root,'output');mkdirSync(output,{recursive:true});
  const lock=resolve(output,'build.lock'),fd=openSync(lock,'wx');
  const staging=resolve(output,'build-staging-'+randomUUID()),dist=resolve(root,'dist'),previous=resolve(output,'build-previous-'+randomUUID());
  try {
    mkdirSync(staging,{recursive:true});
    execute(resolve(root,'node_modules/typescript/bin/tsc'),['-p','tsconfig.build.json','--outDir',staging]);
    execute(resolve(root,'node_modules/vite/bin/vite.js'),['build','--config','studio/vite.config.ts','--outDir',resolve(staging,'studio')]);
    cpSync(resolve(root,'src/modules/media/adapters/render/templates'),resolve(staging,'modules/media/adapters/render/templates'),{recursive:true});
    cpSync(resolve(root,'src/platform/sqlite/schema.sql'),resolve(staging,'platform/sqlite/schema.sql'));
    cpSync(resolve(root,'src/modules/media/adapters/render/blocks'),resolve(staging,'modules/media/adapters/render/blocks'),{recursive:true});
    cpSync(resolve(root,'src/modules/story/application/continuity-auditor.prompt'),resolve(staging,'modules/story/application/continuity-auditor.prompt'));
    writeFileSync(resolve(staging,'build-manifest.json'),JSON.stringify({builtAt:new Date().toISOString(),node:process.version},null,2));
    if(existsSync(dist))renameSync(dist,previous);
    try{renameSync(staging,dist);}catch(error){if(existsSync(previous))renameSync(previous,dist);throw error;}
    return dist;
  } finally {rmSync(staging,{recursive:true,force:true});closeSync(fd);unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))buildProject();
