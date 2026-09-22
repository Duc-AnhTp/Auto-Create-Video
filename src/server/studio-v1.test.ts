import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { StudioServer } from "./studio-server.js";
import axios from "axios";
describe("Studio v1 contracts", () => {
  const studio = new StudioServer({port:0,queuePath:":memory:",workersEnabled:false});
  let url:string;
  beforeAll(async()=>{url=await studio.start();});
  afterAll(async()=>{await studio.close();});
  it("returns an accepted job id and durable status",async()=>{
    const {data,status}=await axios.post(url+"/api/v1/jobs",{seriesId:"test-pilot",episodeNumber:1,rawScreenplay:"TẬP 1: Test"});
    expect(status).toBe(202); expect(data.jobId).toBeTruthy();
    expect((await axios.get(url+"/api/v1/jobs/"+data.jobId)).data.job.status).toBe("queued");
    expect((await axios.post(url+"/api/v1/jobs/"+data.jobId+"/pause",{})).data.job.status).toBe("paused");
  });
  it("rejects traversal, unbudgeted production and cross-origin writes",async()=>{
    const request={seriesId:"../private",episodeNumber:1,rawScreenplay:"test"};
    expect((await axios.post(url+"/api/v1/jobs",request,{validateStatus:()=>true})).status).toBe(400);
    expect((await axios.post(url+"/api/v1/jobs",{...request,seriesId:"pilot",mode:"production",provider:"api_kling"},{validateStatus:()=>true})).status).toBe(400);
    expect((await axios.post(url+"/api/v1/jobs",request,{headers:{Origin:"https://evil.example"},validateStatus:()=>true})).status).toBe(403);
  });
  it("rejects oversize JSON",async()=>{
    expect((await axios.post(url+"/api/v1/jobs",{text:"x".repeat(2_200_000)},{validateStatus:()=>true})).status).toBe(413);
  });
  it("uses optimistic draft versioning",async()=>{
    const endpoint=url+"/api/v1/series/test-pilot/episodes/1/draft";
    expect((await axios.post(endpoint,{baseVersion:0,text:"saved"})).data.version).toBe(1);
    expect((await axios.post(endpoint,{baseVersion:0,text:"stale"},{validateStatus:()=>true})).status).toBe(409);
  });
});
