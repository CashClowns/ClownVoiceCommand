/* ClownVoiceAI on-device transcription worker.
   Runs OpenAI Whisper in the browser through transformers.js.
   The audio never leaves the device: the model is downloaded, the audio is not uploaded. */
const LIB="https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5";
const MODELS={
  tiny:{id:"onnx-community/whisper-tiny.en_timestamped",label:"Fast (tiny, about 45 MB)"},
  base:{id:"onnx-community/whisper-base.en_timestamped",label:"Accurate (base, about 85 MB)"}
};
let pipe=null,loadedKey="",lib=null;

const post=(type,data)=>self.postMessage(Object.assign({type},data||{}));

async function getLib(bust){
  if(lib&&!bust)return lib;
  lib=await import(bust?LIB+"/+esm?retry="+Date.now():LIB);
  lib.env.allowLocalModels=false;
  lib.env.useBrowserCache=true;
  return lib;
}
/* ask the GPU before using it, so we never build a pipeline that cannot run */
async function pickDevice(){
  try{
    const gpu=self.navigator&&self.navigator.gpu;
    if(gpu&&gpu.requestAdapter){const a=await gpu.requestAdapter();if(a)return "webgpu";}
  }catch(e){}
  return "wasm";
}
function progressFn(){
  const seen={};
  return p=>{
    if(p.status==="progress"&&p.file){
      seen[p.file]=p.progress||0;
      const vals=Object.values(seen);
      post("progress",{pct:Math.round(vals.reduce((a,b)=>a+b,0)/vals.length),phase:"download"});
    }else if(p.status==="ready")post("progress",{pct:100,phase:"ready"});
  };
}
async function build(key){
  const model=(MODELS[key]||MODELS.tiny).id;
  const device=await pickDevice();
  const opts=device==="webgpu"
    ? {device:"webgpu",dtype:{encoder_model:"fp32",decoder_model_merged:"q4"}}
    : {device:"wasm",dtype:"q8"};
  post("device",{device,model});
  try{
    const {pipeline}=await getLib();
    return await pipeline("automatic-speech-recognition",model,Object.assign({progress_callback:progressFn()},opts));
  }catch(e){
    if(device==="wasm")throw e;
    /* the GPU claimed it was there and then failed: start over on the CPU with a clean module */
    post("device",{device:"wasm",model,note:String(e&&e.message||e).slice(0,120)});
    const {pipeline}=await getLib(true);
    return await pipeline("automatic-speech-recognition",model,{device:"wasm",dtype:"q8",progress_callback:progressFn()});
  }
}
self.onmessage=async(ev)=>{
  const msg=ev.data||{};
  try{
    if(msg.type==="warm"){
      const key=msg.model||"tiny";
      if(!pipe||loadedKey!==key){pipe=await build(key);loadedKey=key;}
      post("warm-done",{model:loadedKey});
      return;
    }
    if(msg.type==="transcribe"){
      const key=msg.model||"tiny";
      if(!pipe||loadedKey!==key){post("progress",{pct:0,phase:"loading"});pipe=await build(key);loadedKey=key;}
      post("progress",{pct:100,phase:"running"});
      const audio=msg.audio; /* Float32Array at 16 kHz, mono */
      const out=await pipe(audio,{
        return_timestamps:"word",
        chunk_length_s:30,
        stride_length_s:5
      });
      const words=(out.chunks||[]).map(c=>({
        w:String(c.text||"").trim(),
        s:c.timestamp&&c.timestamp[0]!=null?+c.timestamp[0]:null,
        e:c.timestamp&&c.timestamp[1]!=null?+c.timestamp[1]:null
      })).filter(x=>x.w);
      post("result",{text:String(out.text||"").trim(),words,model:loadedKey});
      return;
    }
  }catch(e){
    post("error",{message:String(e&&e.message||e).slice(0,300)});
  }
};
