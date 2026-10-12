import React,{useState} from "react";
export function ProjectAssetsPanel({seriesId,episode,api,onRefresh,onNotice,onError}:{seriesId:string;episode:number;api:<T = unknown>(path:string,body?:unknown)=>Promise<T>;onRefresh:()=>Promise<void>;onNotice:(text:string)=>void;onError:(text:string)=>void}){
  const [entityId,setEntityId]=useState(""),[name,setName]=useState(""),[summary,setSummary]=useState(""),[entityType,setEntityType]=useState("character"),[provider,setProvider]=useState("mock"),[source,setSource]=useState(""),[path,setPath]=useState(""),[mode,setMode]=useState("mock"),[busy,setBusy]=useState(false);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();await onRefresh();}catch(error){onError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <div className="source"><h2>Nhân vật, bối cảnh và reference</h2>
    <label>Loại <select value={entityType} onChange={e=>setEntityType(e.target.value)}><option value="character">Nhân vật</option><option value="location">Bối cảnh</option></select></label>
    <input aria-label="Mã nhân vật hoặc bối cảnh" placeholder="Mã" value={entityId} onChange={e=>setEntityId(e.target.value)}/>
    <input aria-label="Tên nhân vật hoặc bối cảnh" placeholder="Tên" value={name} onChange={e=>setName(e.target.value)}/>
    <textarea aria-label="Mô tả hình ảnh reference" placeholder="Mô tả hình ảnh" value={summary} onChange={e=>setSummary(e.target.value)}/>
    <button disabled={busy||!seriesId||!entityId||!name} onClick={()=>void run(async()=>{await api(`/api/series/${seriesId}/${entityType==="character"?"characters":"locations"}`,{id:entityId,name,visual_summary:summary});onNotice("Đã lưu vào Bible.");})}>Lưu</button>
    <h3>Tạo concept art</h3><select aria-label="Provider concept art" value={provider} onChange={e=>setProvider(e.target.value)}><option value="mock">Mock</option><option value="local_comfyui">ComfyUI</option><option value="cloud">Cloud</option></select>
    <button disabled={busy||!entityId} onClick={()=>void run(async()=>{await api(`/api/v1/series/${seriesId}/references/generate`,{entityId,entityType,provider,turnaround:entityType==="character"});onNotice("Đã tạo reference. Embedding và QA được kiểm tra riêng.");})}>Tạo reference</button>
    <h3>Nhập lại reference hoặc master</h3><p>File phải nằm trong thư mục dữ liệu, output hoặc reference của series này.</p>
    <input aria-label="Đường dẫn artifact" placeholder="Đường dẫn file" value={path} onChange={e=>setPath(e.target.value)}/>
    <input aria-label="Nguồn gốc artifact" placeholder="Nguồn gốc và bằng chứng" value={source} onChange={e=>setSource(e.target.value)}/>
    <select aria-label="Mode artifact nhập" value={mode} onChange={e=>setMode(e.target.value)}><option value="mock">Mock</option><option value="production">Production</option></select>
    <button disabled={busy||!path||source.length<3||!entityId} onClick={()=>void run(async()=>{await api(`/api/v1/series/${seriesId}/artifacts/import`,{episodeNumber:episode,path,kind:"image",entityId,mode,approved:true,source});onNotice("Ảnh đã được kiểm định và ghi nguồn gốc. Embedding chưa được chứng nhận.");})}>Nhập ảnh reference</button>
    <button disabled={busy||!path||source.length<3} onClick={()=>void run(async()=>{await api(`/api/v1/series/${seriesId}/artifacts/import`,{episodeNumber:episode,path,kind:"master",mode,approved:true,source});onNotice("Master đã được đăng ký để chạy hậu kỳ.");})}>Đăng ký master đã duyệt</button>
  </div>;
}
