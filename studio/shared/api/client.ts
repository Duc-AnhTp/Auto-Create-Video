export class ApiError extends Error {
 readonly code:string;
 constructor(readonly status: number, body: unknown) {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const error = data.error;
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  super(typeof error === "string" ? error : typeof detail.message === "string" ? detail.message : "Không thể thực hiện yêu cầu");
  this.code = typeof detail.code === "string" ? detail.code : typeof data.code === "string" ? data.code : "REQUEST_FAILED";
 }
}
export async function request<T=unknown>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(path,body===undefined?{signal}:{signal,method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const text = await response.text();
 let data: unknown;
 try {
  data = text ? JSON.parse(text) : {};
 } catch {
  data = { error: text || response.statusText, code: "HTTP_" + response.status };
 }
 if(!response.ok) throw new ApiError(response.status, data);
 return data as T;
}
export const api=request;
export const media=(path:string)=>"/api/media/stream?path="+encodeURIComponent(path);
export const statusLabel:Record<string,string>={queued:"Đang chờ",running:"Đang chạy",paused:"Tạm dừng",needs_review:"Cần kiểm tra",succeeded:"Hoàn tất",failed:"Thất bại",cancelled:"Đã hủy"};
