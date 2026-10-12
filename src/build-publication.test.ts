import { describe,it,expect } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('staged distribution publication',()=>{
  it.each([1,2])('compiler stage %i failure preserves the existing distribution',async(stage)=>{
    // @ts-expect-error The production builder is a JavaScript entrypoint.
    const {buildProject}=await import("../scripts/build.mjs");
    const root=mkdtempSync(join(tmpdir(),'build-publication-'));mkdirSync(join(root,'dist'));writeFileSync(join(root,'dist','sentinel'),'previous build');
    let calls=0;try{expect(()=>buildProject(root,()=>{if(++calls===stage)throw new Error('deliberate compiler failure');})).toThrow('deliberate compiler failure');expect(readFileSync(join(root,'dist','sentinel'),'utf8')).toBe('previous build');expect(existsSync(join(root,'output','build.lock'))).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
  });
});
