import type {IncomingMessage} from "node:http";
import { readJson } from "./http-safety.js";
import {ProjectPaths} from "../../platform/filesystem/project-paths.js";
/** Reject unsafe media paths before route-specific I/O, including legacy payloads. */
export async function readScopedJson(req:IncomingMessage,url:URL,limit?:number):Promise<unknown>{
  const body=await readJson(req,limit);
  const routeSeries=url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\//)?.[1];
  const series=routeSeries??(body&&typeof body==="object"&&"seriesId" in body?String(body.seriesId):undefined);
  if(series){const paths=new ProjectPaths();const visit=(value:unknown,key="")=>{if(typeof value==="string"&&value&&/(?:path|dir)$/i.test(key))paths.check(series,value,true);else if(Array.isArray(value))for(const item of value)visit(item,key);else if(value&&typeof value==="object")for(const [name,item] of Object.entries(value))visit(item,name);};visit(body);}
  return body;
}
