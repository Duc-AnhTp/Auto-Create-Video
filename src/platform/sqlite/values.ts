import type { SQLInputValue } from "node:sqlite";
/** Match SQLite binding semantics while keeping untrusted values out of typed queries. */
export function sqlInput(value:unknown):SQLInputValue {
 if(value===null||typeof value==="string"||typeof value==="number"||typeof value==="bigint"||value instanceof Uint8Array)return value;
 throw new TypeError("Unsupported SQLite input value");
}
