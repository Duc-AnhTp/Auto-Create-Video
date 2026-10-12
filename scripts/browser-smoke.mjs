import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createRuntime,startRuntime,api,waitFor } from "./smoke-runtime-lib.mjs";

const browserPath=process.env.CHROME_PATH||[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',
].find(existsSync);
if(!browserPath)throw new Error('CHROME_PATH_REQUIRED: install a Chromium browser for offline UI smoke');
const root=await createRuntime('browser-smoke'),host=await startRuntime(root,true),profile=join(root,'browser-profile');await mkdir(profile);
let browser,connection,debugPage;
try {
  await api(host.url,'/api/series/init',{id:'browser-a',title:'Browser A'});
  await api(host.url,'/api/series/init',{id:'browser-b',title:'Browser B'});
  await api(host.url,'/api/v1/series/browser-a/episodes/1/draft',{baseVersion:0,text:'TẬP 1: A'});
  await api(host.url,'/api/v1/series/browser-b/episodes/1/draft',{baseVersion:0,text:'TẬP 1: B'});
  browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='';const wsUrl=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Browser startup timeout: '+stderr)),30000);browser.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);}});browser.once('exit',code=>{clearTimeout(timer);reject(new Error('Browser exited '+code));});});
  connection=new WebSocket(wsUrl);await new Promise((done,reject)=>{connection.addEventListener('open',done,{once:true});connection.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map(),errors=[],inFlightApi=new Set();
  connection.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Network.requestWillBeSent'&&data.params.request.url.includes('/api/')&&!data.params.request.url.includes('/events'))inFlightApi.add(data.params.requestId);if(['Network.loadingFinished','Network.loadingFailed'].includes(data.method))inFlightApi.delete(data.params.requestId);if(data.id){const request=pending.get(data.id);if(request){clearTimeout(request.timer);pending.delete(data.id);data.error?request.reject(new Error(JSON.stringify(data.error))):request.done(data.result);}}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);});
  const call=(method,params={},sessionId)=>new Promise((done,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timeout '+method));},30000);pending.set(key,{done,reject,timer});connection.send(JSON.stringify({id:key,method,params,sessionId}));});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  const cdp=(method,params)=>call(method,params,sessionId);debugPage=cdp;
  await cdp('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.enable',{});await cdp('Runtime.enable',{});await cdp('Network.enable',{});
  const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  await cdp('Page.navigate',{url:host.url+'/studio'});await waitFor(()=>evaluate('document.querySelectorAll(".workspace nav button").length===17'),30000);
  await waitFor(()=>evaluate('document.querySelector("textarea")?.value.includes("TẬP 1:")'),30000);
  const tabs=await evaluate('Array.from(document.querySelectorAll(".workspace nav button")).map(button=>button.textContent)');
  for(let index=0;index<tabs.length;index++){await evaluate(`document.querySelectorAll('.workspace nav button')[${index}].click()`);await new Promise(done=>setTimeout(done,150));}
  await evaluate("document.querySelectorAll('.workspace nav button')[0].click()");
  // Exercise rapid scope changes against the real HTTP API and React state.
  await evaluate(`(()=>{const select=document.querySelector('select');select.value='browser-a';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await evaluate(`(()=>{const select=document.querySelector('select');select.value='browser-b';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(()=>evaluate('document.querySelector("textarea")?.value==="TẬP 1: B"'),30000);
  await evaluate(`(()=>{const input=document.querySelector('input[type="number"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(()=>evaluate('document.querySelector("textarea")?.value===""'),30000);
  await evaluate(`(()=>{const input=document.querySelector('input[type="number"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'1');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(()=>evaluate('document.querySelector("textarea")?.value==="TẬP 1: B"'),30000);
  const setValue=async(selector,value)=>evaluate('(()=>{const element=document.querySelector('+JSON.stringify(selector)+');if(!element)throw new Error("Missing input");const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:element instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value").set.call(element,'+JSON.stringify(value)+');element.dispatchEvent(new Event("input",{bubbles:true}));element.dispatchEvent(new Event("change",{bubbles:true}));})()');
  const click=async(text)=>evaluate('(()=>{const button=Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==='+JSON.stringify(text)+');if(!button||button.disabled)throw new Error("Button unavailable: "+'+JSON.stringify(text)+');button.click();})()');
  await click('＋ Dự án mới');await setValue('[aria-label="Tên dự án mới"]','Browser C');await setValue('[aria-label="Mã dự án mới"]','browser-c');await click('Tạo dự án');
  await waitFor(()=>evaluate('document.querySelector("select").value==="browser-c"'),30000);
  await waitFor(()=>evaluate('Boolean(document.querySelector(".branch-dropdown").value)'),30000);
  // Drain the initial scope requests before editing: branch initialization can
  // start a second scope load and otherwise overwrite a just-saved Bible view.
  await waitFor(async()=>{await evaluate('document.querySelector(".branch-dropdown").value');return inFlightApi.size===0;},30000);
  await evaluate("document.querySelectorAll('.workspace nav button')[2].click()");
  await setValue('[aria-label="Mã nhân vật hoặc bối cảnh"]','hero');await setValue('[aria-label="Tên nhân vật hoặc bối cảnh"]','Nhân vật thử');await setValue('[aria-label="Mô tả hình ảnh reference"]','Áo xanh, tóc ngắn.');await click('Lưu');
  await waitFor(()=>evaluate('document.querySelector(".notice")?.textContent.includes("Đã lưu vào Bible")||document.body.textContent.includes("Đã lưu vào Bible")'),30000);
  await click('Tạo reference');await waitFor(()=>evaluate('document.body.textContent.includes("Đã tạo reference")'),30000);
  await evaluate("document.querySelectorAll('.workspace nav button')[0].click()");
  const screenplay='TẬP 1: BROWSER SMOKE\nLogline: Bình minh.\nCẢNH 1: CÔNG VIÊN - NGÀY\nCÚ MÁY 1 (establishing, 2s): Mặt trời mọc.\nCÚ MÁY 2 (wide, 2s): Cây xanh bên hồ.';
  await setValue('[aria-label="Kịch bản phân cảnh"]',screenplay);await click('Lưu kịch bản');await waitFor(()=>evaluate('document.body.textContent.includes("Đã lưu bản nháp")'),30000);
  const previousJobs=new Set((await api(host.url,'/api/v1/jobs')).jobs.map(job=>job.id));
  await setValue('[aria-label="Provider video"]','mock');await setValue('[aria-label="Độ phân giải xuất"]','720p');await click('▶ Tạo bản thử (Mock)');
  const completed=await waitFor(async()=>{const {jobs}=await api(host.url,'/api/v1/jobs');const job=jobs.find(job=>job.request.seriesId==='browser-c'&&job.request.kind==='episode'&&!previousJobs.has(job.id));if(job&&['failed','needs_review','cancelled'].includes(job.status))throw new Error('Mock UI job '+JSON.stringify(job.error));return job?.status==='succeeded'?job:null;},120000);
  if(!completed.result.isMock||completed.result.qaStatus!=='MOCK'||!completed.result.artifactIds.length)throw new Error('Mock provenance/artifact missing');
  if((await api(host.url,'/api/v1/series/browser-c/episodes/1/draft')).text!==screenplay)throw new Error('Draft save did not persist');
  await waitFor(()=>evaluate('document.querySelector(".queue")?.textContent.includes("Hoàn tất")||document.body.textContent.includes("Hoàn tất")'),30000);
  if(await evaluate('Boolean(document.querySelector(".error"))'))throw new Error('Studio displays an error after production');
  const masterBefore=await readFile(resolve(root,completed.result.videoPath));
  const takesBefore=(await api(host.url,'/api/v1/series/browser-c/episodes/1/takes')).takes;
  const promptOverride='Closer sunrise framing';
  await evaluate("Array.from(document.querySelectorAll('.nle-clip')).find(clip=>clip.querySelector('.clip-name')?.textContent==='sc01_sh01').click()");
  await evaluate("Array.from(document.querySelectorAll('.workspace nav button')).find(button=>button.textContent.includes('So sánh Take')).click()");
  await waitFor(()=>evaluate('Boolean(document.querySelector(".reroll-inputs input"))'),30000);
  await waitFor(()=>evaluate('document.querySelector(".comparison-subtitle")?.textContent.includes("1 takes")'),30000);
  await setValue('.reroll-inputs input',promptOverride);await click('↻ Render Take Mới');
  const rerolled=await waitFor(async()=>{const {jobs}=await api(host.url,'/api/v1/jobs');const job=jobs.find(job=>job.request.targetShotId==='sc01_sh01');if(job?.status==='failed')throw new Error('Reroll failed '+JSON.stringify(job.error));return job?.status==='needs_review'&&job.result?.reroll?job:null;},60000);
  if(rerolled.request.promptOverride!==promptOverride||rerolled.result.reroll.isApproved)throw new Error('Reroll input/approval contract failed');
  const takesAfter=(await api(host.url,'/api/v1/series/browser-c/episodes/1/takes')).takes;
  if(takesAfter.length!==takesBefore.length+1||takesAfter.filter(take=>take.shot_id==='sc01_sh02').length!==takesBefore.filter(take=>take.shot_id==='sc01_sh02').length)throw new Error('Reroll affected another shot');
  if(!masterBefore.equals(await readFile(resolve(root,completed.result.videoPath))))throw new Error('Reroll replaced the master before approval');
  await waitFor(()=>evaluate('document.body.textContent.includes("Cần kiểm tra")'),30000);
  await waitFor(()=>evaluate('document.querySelector(".comparison-subtitle")?.textContent.includes("2 takes")'),30000);
  await evaluate("Array.from(document.querySelectorAll('.workspace nav button')).find(button=>button.textContent.includes('Preview Master')).click()");
  await waitFor(()=>evaluate('Array.from(document.querySelectorAll(".workspace nav button")).some(button=>button.textContent.includes("Preview Master")&&button.classList.contains("active"))&&Boolean(document.querySelector(".preview video"))'),30000);
  const masterPreview=await evaluate('document.querySelector(".preview video").getAttribute("src")');
  if(new URL(masterPreview,host.url).searchParams.get('path')!==completed.result.videoPath)throw new Error('Master preview selected a pending shot take');
  if(await evaluate('Boolean(document.querySelector(".error"))'))throw new Error('Studio displays an error after reroll');
  const flows={createSeries:true,createCharacter:true,mockReference:true,saveDraft:true,mockProduction:true,registeredArtifact:true,targetedReroll:true,rerollReviewGate:true,masterPreserved:true};
  if(errors.length)throw new Error('Browser exceptions: '+errors.join('; '));
  const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,'studio.png'),Buffer.from(screenshot.data,'base64'));
  await writeFile(join(root,'browser-result.json'),JSON.stringify({node:process.version,browser:browserPath,tabs,scopeRace:true,episodeSwitch:true,exceptions:errors,flows},null,2));
  console.log(JSON.stringify({root,tabs:tabs.length,scopeRace:true,episodeSwitch:true,flows}));
} catch(error) {
  if(debugPage){try{const screenshot=await debugPage('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'failure.png'),Buffer.from(screenshot.data,'base64'));const state=await debugPage('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true});await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error),page:state.result?.value},null,2));}catch{}}
  throw error;
} finally {connection?.close();browser?.kill();await host.close();}
