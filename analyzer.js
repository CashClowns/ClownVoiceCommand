/* ClownVoiceCommand voice analyzer
   One engine for live mic takes and uploaded files.
   Pipeline: capture raw PCM -> resample to 16 kHz -> 10 ms intensity frames + YIN pitch (20 ms hop)
   -> adaptive voice activity -> phrases -> pauses, freezes, trail-off, end-of-statement tone,
   pitch range, syllable-nuclei speaking rate, hesitation estimate. */
(function(){
const SR=16000;

/* ---------- capture ---------- */
function Recorder(){
  let ctx=null,stream=null,src=null,proc=null,chunks=[],inSr=48000,onTick=null,t0=0,last=new Float32Array(0);
  this.active=false;
  this.start=async function(tick){
    onTick=tick;const AC=window.AudioContext||window.webkitAudioContext;ctx=new AC();const resumed=ctx.resume();
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){try{ctx.close();}catch(e){}throw Object.assign(new Error("no-mic"),{name:"NotSupportedError"});}
    try{stream=await Promise.race([navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}}),new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error("mic-timeout"),{name:"TimeoutError"})),10000))]);}
    catch(e){try{ctx.close();}catch(x){}throw e;}
    await resumed;inSr=ctx.sampleRate;chunks=[];
    src=ctx.createMediaStreamSource(stream);proc=ctx.createScriptProcessor(4096,1,1);
    const mute=ctx.createGain();mute.gain.value=0;
    proc.onaudioprocess=e=>{const d=new Float32Array(e.inputBuffer.getChannelData(0));chunks.push(d);
      let s=0,pk=0;for(let i=0;i<d.length;i++){const v=d[i];s+=v*v;const a=v<0?-v:v;if(a>pk)pk=a;}
      const db=20*Math.log10(Math.sqrt(s/d.length)+1e-9);
      const tail=resample(d,inSr,SR);const f0=tail.length>=900?yinFrame(tail,tail.length-600,512):0;
      onTick&&onTick({sec:(performance.now()-t0)/1000,db,peak:20*Math.log10(pk+1e-9),f0});};
    src.connect(proc);proc.connect(mute);mute.connect(ctx.destination);t0=performance.now();this.active=true;
  };
  this.stop=async function(){
    this.active=false;try{src&&src.disconnect();proc&&proc.disconnect();}catch(e){}
    stream&&stream.getTracks().forEach(t=>t.stop());try{ctx&&ctx.close();}catch(e){}
    let n=0;chunks.forEach(c=>n+=c.length);const all=new Float32Array(n);let o=0;chunks.forEach(c=>{all.set(c,o);o+=c.length;});chunks=[];
    return {samples:all,sr:inSr};
  };
}

/* ---------- decode an uploaded file ---------- */
async function decodeFile(file){
  const AC=window.AudioContext||window.webkitAudioContext;const c=new AC();const ab=await file.arrayBuffer();
  const buf=await new Promise((res,rej)=>{const p=c.decodeAudioData(ab,res,rej);if(p&&p.then)p.then(res,rej);});
  const ch=buf.numberOfChannels,len=buf.length,mono=new Float32Array(len);
  for(let k=0;k<ch;k++){const d=buf.getChannelData(k);for(let i=0;i<len;i++)mono[i]+=d[i]/ch;}
  try{c.close();}catch(e){}return {samples:mono,sr:buf.sampleRate};
}

/* ---------- DSP helpers ---------- */
function resample(x,from,to){
  if(from===to)return x;const ratio=from/to,n=Math.floor(x.length/ratio),y=new Float32Array(n);
  for(let j=0;j<n;j++){const a=j*ratio,b=a+ratio;let i0=Math.floor(a),i1=Math.min(x.length,Math.ceil(b)),s=0,c=0;for(let i=i0;i<i1;i++){s+=x[i];c++;}y[j]=c?s/c:0;}
  return y;
}
/* YIN (de Cheveigne & Kawahara 2002) on one frame starting at `start`, window W, 16 kHz */
function yinFrame(x,start,W){
  const tMin=Math.floor(SR/450),tMax=Math.floor(SR/65);if(start+W+tMax>x.length)return 0;
  let e=0;for(let i=0;i<W;i++){const v=x[start+i];e+=v*v;}if(Math.sqrt(e/W)<0.003)return 0;
  const d=new Float32Array(tMax+2);
  for(let t=1;t<=tMax+1;t++){let s=0;for(let i=0;i<W;i++){const df=x[start+i]-x[start+i+t];s+=df*df;}d[t]=s;}
  let run=0;const cm=new Float32Array(tMax+2);cm[0]=1;for(let t=1;t<=tMax+1;t++){run+=d[t];cm[t]=run>0?d[t]*t/run:1;}
  let tau=-1;for(let t=tMin;t<=tMax;t++){if(cm[t]<0.15){while(t+1<=tMax&&cm[t+1]<cm[t])t++;tau=t;break;}}
  if(tau<0){let best=1,bt=-1;for(let t=tMin;t<=tMax;t++)if(cm[t]<best){best=cm[t];bt=t;}if(best<0.3)tau=bt;else return 0;}
  const a=cm[tau-1],b=cm[tau],c=cm[tau+1];const den=a-2*b+c;const shift=den!==0?0.5*(a-c)/den:0;
  const f=SR/(tau+(Math.abs(shift)<1?shift:0));return f>=65&&f<=450?f:0;
}
const st=(a,b)=>12*Math.log2(a/b);
const median=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
const pct=(a,p)=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*p))];};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;

/* ---------- full analysis ---------- */
function analyze(samples,inSr,opts={}){
  const x=resample(samples,inSr,SR);const dur=x.length/SR;
  if(dur<1)return null;
  let pk=0;for(let i=0;i<x.length;i++){const a=x[i]<0?-x[i]:x[i];if(a>pk)pk=a;}
  let rawPk=0;for(let i=0;i<samples.length;i++){const a=samples[i]<0?-samples[i]:samples[i];if(a>rawPk)rawPk=a;}
  const peakDb=20*Math.log10(rawPk+1e-9);
  // 10 ms intensity frames (25 ms window)
  const hop=160,win=400,nF=Math.max(0,Math.floor((x.length-win)/hop)+1),dB=new Float32Array(nF);
  for(let f=0;f<nF;f++){let s=0;const o=f*hop;for(let i=0;i<win;i++){const v=x[o+i];s+=v*v;}dB[f]=Math.max(-100,20*Math.log10(Math.sqrt(s/win)+1e-9));}
  // pitch every 20 ms
  const f0=new Float32Array(nF);for(let f=0;f<nF;f+=2){const v=yinFrame(x,f*hop,512);f0[f]=v;if(f+1<nF)f0[f+1]=v;}
  // clean octave jumps: median-of-5 on voiced frames
  const f0c=f0.slice();for(let f=2;f<nF-2;f++){if(!f0[f])continue;const w=[f0[f-2],f0[f-1],f0[f],f0[f+1],f0[f+2]].filter(v=>v>0);if(w.length>=3){const m=median(w);if(Math.abs(st(f0[f],m))>5)f0c[f]=m;}}
  // adaptive voice activity
  const sorted=Array.from(dB).sort((a,b)=>a-b);const noise=sorted[Math.floor(sorted.length*0.1)],loud=sorted[Math.floor(sorted.length*0.95)];
  const thr=Math.max(noise+Math.min(12,Math.max(6,(loud-noise)*0.3)),loud-40,-60);
  const act=new Uint8Array(nF);for(let f=0;f<nF;f++)act[f]=(dB[f]>thr||f0c[f]>0&&dB[f]>thr-6)?1:0;
  // segments: merge gaps < 250 ms, drop blips < 120 ms
  let segs=[],cur=null;for(let f=0;f<nF;f++){if(act[f]){if(cur&&f-cur.e<=25)cur.e=f;else{cur={s:f,e:f};segs.push(cur);}}}
  segs=segs.filter(s=>(s.e-s.s+1)*0.01>=0.12);
  if(!segs.length)return {empty:true,dur:+dur.toFixed(1),peak:+peakDb.toFixed(1),noiseDb:+noise.toFixed(1)};
  // phrases: split at pauses >= 400 ms
  const gaps=[];for(let i=1;i<segs.length;i++)gaps.push({len:(segs[i].s-segs[i-1].e)*0.01,at:segs[i-1].e*0.01});
  const phrases=[];let p={s:segs[0].s,e:segs[0].e};for(let i=1;i<segs.length;i++){if(gaps[i-1].len>=0.35){phrases.push(p);p={s:segs[i].s,e:segs[i].e};}else p.e=segs[i].e;}phrases.push(p);
  const speakStart=segs[0].s*0.01,speakEnd=(segs[segs.length-1].e+1)*0.01,span=speakEnd-speakStart;
  const phon=segs.reduce((a,s)=>a+(s.e-s.s+1)*0.01,0);
  const pauses=gaps.filter(g=>g.len>=0.3),freezes=gaps.filter(g=>g.len>=1.5);
  // per phrase: tone at the end (slope of last voiced 350 ms), trail-off, loudness
  const semis=v=>12*Math.log2(v/100);
  const out=phrases.map(ph=>{
    const len=(ph.e-ph.s+1)*0.01;const idx=[];for(let f=ph.s;f<=ph.e;f++)if(f0c[f]>0)idx.push(f);
    let tone="n/a",slope=null;
    if(len>=0.6&&idx.length>=8){const endF=idx[idx.length-1];const tail=idx.filter(f=>f>=endF-35);
      if(tail.length>=6){const xs=tail.map(f=>f*0.01),ys=tail.map(f=>semis(f0c[f]));const mx=mean(xs),my=mean(ys);let nu=0,de=0;xs.forEach((v,i)=>{nu+=(v-mx)*(ys[i]-my);de+=(v-mx)*(v-mx);});
        slope=de?nu/de:0;const change=slope*(xs[xs.length-1]-xs[0]);tone=change<=-1?"falling":change>=1?"rising":"flat";slope=+change.toFixed(1);}}
    const actIdx=[];for(let f=ph.s;f<=ph.e;f++)if(act[f])actIdx.push(f);const all=actIdx.map(f=>dB[f]),endDb=actIdx.filter(f=>f>=ph.e-30).map(f=>dB[f]);
    const trail=len>=0.8&&endDb.length>=5?+(mean(endDb)-mean(all)).toFixed(1):null;
    return {start:+(ph.s*0.01).toFixed(2),end:+((ph.e+1)*0.01).toFixed(2),len:+len.toFixed(2),tone,change:slope,trail,level:+mean(all).toFixed(1)};
  });
  const toned=out.filter(o=>o.tone!=="n/a");
  const fall=toned.filter(o=>o.tone==="falling").length,rise=toned.filter(o=>o.tone==="rising").length,flat=toned.length-fall-rise;
  const voiced=[];for(let f=0;f<nF;f++)if(f0c[f]>0&&act[f])voiced.push(f0c[f]);
  const rangeSt=voiced.length>30?+st(pct(voiced,0.9),pct(voiced,0.1)).toFixed(1):null;
  // syllable nuclei (de Jong & Wempe 2009, simplified): intensity peaks >= 2 dB above the dip before, voiced, above threshold
  const sm=new Float32Array(nF);for(let f=0;f<nF;f++){let s=0,c=0;for(let k=-2;k<=2;k++){const g=f+k;if(g>=0&&g<nF){s+=dB[g];c++;}}sm[f]=s/c;}
  const peakThr=Math.max(thr,pct(Array.from(sm).filter((v,i)=>act[i]),0.5)-12);let syl=0,lastDip=Infinity,lastPeakF=-99;
  for(let f=1;f<nF-1;f++){if(sm[f]<lastDip)lastDip=sm[f];
    if(sm[f]>sm[f-1]&&sm[f]>=sm[f+1]&&act[f]&&sm[f]>peakThr&&sm[f]-lastDip>=2){let v=false;for(let k=-3;k<=3;k++){if(f0c[f+k]>0){v=true;break;}}
      if(v&&f-lastPeakF>=8){syl++;lastPeakF=f;lastDip=sm[f];}}}
  const artRate=phon>0?syl/phon:0,estWpm=span>0?Math.round(syl/1.45/span*60):null;
  // hesitation estimate: sustained voiced stretch >= 300 ms with very flat pitch and steady level (um/uh sounds)
  let hes=0;for(const s of segs){let run=[],runDb=[];for(let f=s.s;f<=s.e+1;f++){const v=f<=s.e?f0c[f]:0;if(v>0){run.push(v);runDb.push(dB[f]);}else{if(run.length>=30){const r=run.map(semis),m=mean(r),sd=Math.sqrt(mean(r.map(q=>(q-m)*(q-m)))),md=mean(runDb),sdd=Math.sqrt(mean(runDb.map(q=>(q-md)*(q-md))));if(sd<0.6&&sdd<2.5)hes++;}run=[];runDb=[];}}}
  // loudness consistency across phrases
  const lv=out.map(o=>o.level),lvSd=lv.length>1?+Math.sqrt(mean(lv.map(q=>(q-mean(lv))*(q-mean(lv))))).toFixed(1):0;
  const trails=out.map(o=>o.trail).filter(v=>v!=null);
  return {
    dur:+dur.toFixed(1),sec:+span.toFixed(1),speechSec:+phon.toFixed(1),talkRatio:+(phon/span).toFixed(2),
    pauses:pauses.length,meanPause:pauses.length?+mean(pauses.map(g=>g.len)).toFixed(2):0,longest:gaps.length?+Math.max(...gaps.map(g=>g.len)).toFixed(1):0,
    freezes:freezes.length,freezeAt:freezes.map(g=>+g.at.toFixed(1)),freezeGaps:freezes.map(g=>({at:+g.at.toFixed(2),len:+g.len.toFixed(2)})),
    phrases:out,toneN:toned.length,fall,rise,flat,falling:toned.length?Math.round(fall/toned.length*100):null,
    medianF0:voiced.length?Math.round(median(voiced)):null,rangeSt,monotone:rangeSt!=null&&rangeSt<4,
    syllables:syl,artRate:+artRate.toFixed(2),estWpm,hesitations:hes,
    trailAvg:trails.length?+mean(trails).toFixed(1):null,trailing:trails.filter(t=>t<-4).length,trailN:trails.length,
    levelSd:lvSd,peak:+peakDb.toFixed(1),noiseDb:+noise.toFixed(1),snr:+(loud-noise).toFixed(1),
    contour:{dB:Array.from(dB,v=>+v.toFixed(1)),f0:Array.from(f0c,v=>Math.round(v)),thr:+thr.toFixed(1)}
  };
}

/* ---------- WAV for playback ---------- */
function toWav(samples,inSr){
  const x=resample(samples,inSr,SR),b=new ArrayBuffer(44+x.length*2),v=new DataView(b);const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  w(0,"RIFF");v.setUint32(4,36+x.length*2,true);w(8,"WAVE");w(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,SR,true);v.setUint32(28,SR*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,"data");v.setUint32(40,x.length*2,true);
  for(let i=0;i<x.length;i++){const s=Math.max(-1,Math.min(1,x[i]));v.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true);}
  return new Blob([b],{type:"audio/wav"});
}

window.VoiceAnalyzer={Recorder,decodeFile,analyze,toWav,resample,yinFrame,SR};
})();
