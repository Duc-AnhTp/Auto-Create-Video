import {it,expect} from 'vitest';
import {redact} from './redact.js';
it('removes configured credentials, bearer tokens and signed URLs from diagnostics',()=>{
 const previous=process.env.AUDIT_TEST_API_KEY;
 try{
  process.env.AUDIT_TEST_API_KEY='audit-private-credential';
  const result=redact('audit-private-credential Bearer private-token https://user:password@provider.example/audio?signature=private-signature');
  for(const secret of ['audit-private-credential','private-token','password','private-signature','https://'])expect(result).not.toContain(secret);
  expect(result).toContain('[URL_REDACTED]');
 }finally{if(previous===undefined)delete process.env.AUDIT_TEST_API_KEY;else process.env.AUDIT_TEST_API_KEY=previous;}
});
