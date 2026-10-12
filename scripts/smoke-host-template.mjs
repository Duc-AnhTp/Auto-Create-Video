import './dist/platform/processes/media-runtime.js';
import { StudioServer } from './dist/bootstrap/studio-server.js';
const server=new StudioServer({port:0,workersEnabled:process.env.SMOKE_WORKERS==='1'});
const url=await server.start();process.send?.({url});
process.on('message',async message=>{if(message==='close'){await server.close();process.exit(0);}});
