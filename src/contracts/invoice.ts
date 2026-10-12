/** Provider payloads may encode an amount as a numeric string. Other coercions
 * (null, booleans and empty strings) must never manufacture a zero invoice. */
export function normalizeInvoiceAmount(value:unknown):number|undefined {
 if(typeof value!=='number'&&(typeof value!=='string'||!value.trim()))return undefined;
 const amount=Number(value);
 return Number.isFinite(amount)&&amount>=0?amount:undefined;
}
