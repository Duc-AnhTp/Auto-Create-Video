import { copyFile,writeFile,rm,mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { assertMediaOwnership,publishMediaRename } from "../processes/media-process-runner.js";
export async function atomicWriteFile(target:string,data:Parameters<typeof writeFile>[1],options?:Parameters<typeof writeFile>[2]):Promise<void>{
  assertMediaOwnership();const temporary=target+"."+randomUUID()+".publishing";
  try{await writeFile(temporary,data,options);publishMediaRename(temporary,target);}finally{await rm(temporary,{force:true});}
}
export async function atomicCopyFile(source:string,target:string,assertOwnership?:()=>void):Promise<void>{
  if(source===target)return;
  await mkdir(dirname(target),{recursive:true});const temporary=target+"."+randomUUID()+".publishing";
  try{await copyFile(source,temporary);assertOwnership?.();assertMediaOwnership();publishMediaRename(temporary,target);}finally{await rm(temporary,{force:true});}
}
