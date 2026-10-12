import { describe,it,expect } from "vitest";
import { createServer } from "node:http";
import { StoryAnalysisEngine } from "./story-analyzer.js";
import type { LlmRequestEvidence } from "../../../../contracts/usage.js";

describe("offline API usage evidence",()=>{
  it("persists usage only from responses and marks missing usage unavailable",async()=>{
    let includeUsage=true;const server=createServer((request,response)=>{request.resume();response.setHeader("Content-Type","application/json");response.end(JSON.stringify({choices:[{message:{content:"fixture"}}],...(includeUsage?{usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:40}}}:{})}));});
    await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));const previous=process.env.CUSTOM_LLM_URL;process.env.CUSTOM_LLM_URL="http://127.0.0.1:"+(server.address() as {port:number}).port;
    const events:LlmRequestEvidence[]=[],usage:unknown[]=[];
    try{
      const options={llmProvider:"custom" as const,llmApiKey:"fixture-key",onUsageTracked:(value:unknown)=>usage.push(value),onRequestEvidence:(value:LlmRequestEvidence)=>events.push(value)};
      await StoryAnalysisEngine.callLlmApi("same source","system",options);includeUsage=false;await StoryAnalysisEngine.callLlmApi("same source","system",{...options,requestPurpose:"repair"});
      expect(usage).toHaveLength(1);expect(events[0]).toMatchObject({usageStatus:"available",inputTokens:100,outputTokens:20,cachedTokens:40});expect(events[1]).toMatchObject({usageStatus:"unavailable",purpose:"repair",outcome:"completed"});expect(events[1].inputTokens).toBeUndefined();
    }finally{if(previous===undefined)delete process.env.CUSTOM_LLM_URL;else process.env.CUSTOM_LLM_URL=previous;await new Promise<void>(done=>server.close(()=>done()));}
  });
});
