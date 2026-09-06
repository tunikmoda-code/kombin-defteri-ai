const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const HF_SPACE = 'https://yisol-idm-vton.hf.space';

app.use(express.json({ limit: '50mb' }));
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(__dirname));

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const hfHeaders = () => process.env.HF_TOKEN ? {Authorization:`Bearer ${process.env.HF_TOKEN}`} : {};

function dataUriToBlob(s){
  const m=/^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(s||'');
  if(!m) throw Error('Geçersiz görsel verisi.');
  return new Blob([Buffer.from(m[2], /;base64,/.test(s)?'base64':'utf8')], {type:m[1]||'image/jpeg'});
}

async function uploadImage(image){
  if(typeof image==='string' && /^https?:\/\//i.test(image)) return image;
  const blob = typeof image==='string' && image.startsWith('data:')
    ? dataUriToBlob(image)
    : new Blob([Buffer.from(image)], {type:'image/jpeg'});
  const form = new FormData();
  form.append('files', blob, 'image.jpg');
  const r = await fetch(`${HF_SPACE}/gradio_api/upload`, {method:'POST', headers:hfHeaders(), body:form});
  const t = await r.text();
  if(!r.ok) throw Error(`Hugging Face görsel yükleme hatası (${r.status}): ${t.slice(0,300)}`);
  const d = JSON.parse(t);
  if(!Array.isArray(d)||!d[0]) throw Error('Hugging Face görsel yolu döndürmedi.');
  return d[0];
}

async function callTryOn(modelImage, productImage, desc){
  const [mp,gp] = await Promise.all([uploadImage(modelImage), uploadImage(productImage)]);
  const payload={data:[
    {background:{path:mp,meta:{_type:'gradio.FileData'},orig_name:'model.jpg'},layers:[],composite:null},
    {path:gp,meta:{_type:'gradio.FileData'},orig_name:'garment.jpg'},
    desc||'', true, false, 30, 42
  ]};
  const r=await fetch(`${HF_SPACE}/gradio_api/call/tryon`,{method:'POST',headers:{'Content-Type':'application/json',...hfHeaders()},body:JSON.stringify(payload)});
  const t=await r.text();
  if(!r.ok) throw Error(`Hugging Face AI başlatma hatası (${r.status}): ${t.slice(0,400)}`);
  const s=JSON.parse(t);
  if(!s.event_id) throw Error('Hugging Face event_id döndürmedi.');
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){
    const q=await fetch(`${HF_SPACE}/gradio_api/call/tryon/${s.event_id}`,{headers:hfHeaders()});
    const body=await q.text();
    if(!q.ok) throw Error(`Hugging Face sonuç hatası (${q.status}): ${body.slice(0,300)}`);
    for(const block of body.split(/\n\n+/)){
      const em=block.match(/(?:^|\n)event:\s*([^\n]+)/);
      const dm=block.match(/(?:^|\n)data:\s*([\s\S]*?)(?:\n|$)/);
      if(!dm) continue;
      const ev=em?em[1].trim():'';
      const raw=dm[1].trim();
      if(raw==='null') continue;
      let data; try{data=JSON.parse(raw)}catch{continue;}
      if(ev==='error') throw Error(typeof data==='string'?data:JSON.stringify(data));
      if(ev==='complete') return data;
    }
    await sleep(2000);
  }
  throw Error('Hugging Face AI işlemi 240 saniyede tamamlanmadı.');
}

async function outputToDataUri(output){
  let u=typeof output==='string'?output:(output&&(output.url||output.path));
  if(!u) throw Error('AI görüntü yolu bulunamadı.');
  if(u.startsWith('data:')) return u;
  if(u.startsWith('/')) u=HF_SPACE+u;
  if(!/^https?:\/\//i.test(u)) u=HF_SPACE+'/'+u.replace(/^\/+/, '');
  const r=await fetch(u,{headers:hfHeaders()});
  if(!r.ok) throw Error(`AI görseli alınamadı (${r.status}).`);
  const ct=r.headers.get('content-type')||'image/png';
  return `data:${ct};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
}

app.post('/api/tryon', async (req,res)=>{
  try{
    const {modelImage,productImage,category,itemName}=req.body||{};
    if(!modelImage||!productImage) return res.status(400).json({error:'Manken fotoğrafı ve ürün fotoğrafı gerekli.'});
    const result=await callTryOn(modelImage,productImage,`${category||'fashion item'} ${itemName||''}`.trim());
    const image=await outputToDataUri(Array.isArray(result)?result[0]:result);
    res.json({image});
  }catch(err){
    console.error(err);
    res.status(500).json({error:err.message||'Hugging Face AI hatası.'});
  }
});

app.get('/api/health',(_req,res)=>res.json({ok:true,service:'kombin-defteri-ai',engine:'huggingface-idm-vton'}));
app.listen(PORT,()=>console.log(`Kombin Defteri AI - Hugging Face IDM-VTON: http://localhost:${PORT}`));
