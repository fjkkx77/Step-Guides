const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.argv[2], PORT=+(process.argv[3]||8813), store={};
// 必须按扩展名给正确的 content-type：Chrome 标准模式会拒绝应用 MIME 不是 text/css 的样式表，
// 早先这里非 .html 一律发 text/plain，外链 style.css 会静默不生效 —— 测了等于没测（2026-09-12 踩过）
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp',
  '.woff2':'font/woff2','.woff':'font/woff','.txt':'text/plain; charset=utf-8'};
http.createServer((q,s)=>{
  const u=new URL(q.url,'http://x');
  if(u.pathname.startsWith('/api/sync')){
    const k=u.searchParams.get('code')||'x';
    if(q.method==='GET'){s.writeHead(200,{'content-type':'application/json'});return s.end(JSON.stringify(store[k]||{ok:true,doc:null}));}
    let b='';q.on('data',d=>b+=d);q.on('end',()=>{store[k]=JSON.parse(b||'{}');s.writeHead(200,{'content-type':'application/json'});s.end('{"ok":true}');});
    return;
  }
  // 目录 -> index.html（GitHub Pages 就是这个行为，本地必须一致，否则测的跟线上不是一回事）
  let rel=u.pathname;
  let f=path.join(ROOT,rel==='/'?'index.html':rel);
  try{ if(fs.existsSync(f)&&fs.statSync(f).isDirectory()) f=path.join(f,'index.html'); }catch(_){}
  if(rel.endsWith('/')&&!f.endsWith('index.html')) f=path.join(f,'index.html');
  fs.readFile(f,(e,d)=>{ if(e){s.writeHead(404);return s.end('404');}
    s.writeHead(200,{'content-type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});s.end(d);});
}).listen(PORT,()=>console.log('mock on '+PORT));
