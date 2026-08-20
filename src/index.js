const json=(x,s=200,h={})=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','cache-control':'no-store',...h}});
const id=()=>crypto.randomUUID(); const now=()=>new Date().toISOString();
const hex=buf=>[...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');
const unhex=h=>new Uint8Array((h.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));
function cookie(name,value,maxAge){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`}
function clean(s,max=500){return String(s??'').trim().slice(0,max)}
function timingSafe(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function hashPassword(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'PBKDF2'},false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$100000$${hex(salt)}$${hex(bits)}`;
}
async function verifyPassword(password,stored){
  if(!stored?.startsWith('pbkdf2$'))return false;
  const [,it,saltHex,hashHex]=stored.split('$');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'PBKDF2'},false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(saltHex),iterations:Number(it),hash:'SHA-256'},key,256);
  return timingSafe(hex(bits),hashHex);
}
async function session(req,env){const c=req.headers.get('Cookie')||'';const m=c.match(/(?:^|;\s*)lp_session=([^;]+)/);if(!m)return null;return env.DB.prepare("SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=? AND s.expires_at>datetime('now')").bind(m[1]).first()}
function auth(req,env){return session(req,env)}
async function stripeApi(env,path,body){
  const key=env.STRIPE_SECRET_KEY;if(!key)return {ok:false,status:503,data:{error:{message:'Stripe is not connected yet.'}}};
  const r=await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  return {ok:r.ok,status:r.status,data:await r.json()};
}
async function verifyStripe(raw,sig,secret){
  if(!sig||!secret)return false;
  const vals={};for(const part of sig.split(',')){const i=part.indexOf('=');if(i>0)vals[part.slice(0,i)]=part.slice(i+1)}
  const ts=Number(vals.t), v1=vals.v1;if(!Number.isFinite(ts)||!v1||Math.abs(Date.now()/1000-ts)>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${ts}.${raw}`)));
  return timingSafe(mac,v1);
}
async function sendEmail(env,to,subject,text){
  if(!env.RESEND_API_KEY||!to)return false;
  const from=env.FROM_EMAIL||'LeadPilot AI <onboarding@resend.dev>';
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from,to,subject,text})});
  return r.ok;
}
function followupText(l,o){const service=o?.service||'your enquiry';const book=o?.booking_url?` You can book here: ${o.booking_url}`:'';return `Hi ${l.name},\n\nThanks for your enquiry about ${service}. Just checking whether you still need help. We’d be happy to answer any questions or get you booked in.${book}\n\nBest,\n${o?.business_name||'The team'}`}

export default {
 async fetch(req,env){
  const u=new URL(req.url),p=u.pathname;
  if(req.method==='GET'&&p==='/api/health')return json({ok:true,service:'LeadPilot AI',automations:['accounts','onboarding','leads','followups','stripe']});
  if(req.method==='POST'&&p==='/api/signup'){
   const b=await req.json();const email=clean(b.email,160).toLowerCase();const password=String(b.password||'');
   if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return json({error:'Valid email and password (8+ characters) required'},400);
   const exists=await env.DB.prepare('SELECT id FROM accounts WHERE email=?').bind(email).first();if(exists)return json({error:'An account already exists for this email.'},409);
   const aid=id(), sid=id();await env.DB.prepare('INSERT INTO accounts(id,email,password_hash,business_name,created_at) VALUES(?,?,?,?,?)').bind(aid,email,await hashPassword(password),clean(b.business_name,160),now()).run();
   await env.DB.prepare('INSERT INTO sessions(id,account_id,expires_at,created_at) VALUES(?,?,datetime(\'now\',\'+30 days\'),?)').bind(sid,aid,now()).run();
   return json({ok:true,next:'/onboarding.html'},{headers:{'set-cookie':cookie('lp_session',sid,60*60*24*30)}});
  }
  if(req.method==='POST'&&p==='/api/login'){
   const b=await req.json();const a=await env.DB.prepare('SELECT * FROM accounts WHERE email=?').bind(clean(b.email,160).toLowerCase()).first();
   if(!a||!(await verifyPassword(String(b.password||''),a.password_hash)))return json({error:'Invalid email or password.'},401);
   const sid=id();await env.DB.prepare('INSERT INTO sessions(id,account_id,expires_at,created_at) VALUES(?,?,datetime(\'now\',\'+30 days\'),?)').bind(sid,a.id,now()).run();
   return json({ok:true},{headers:{'set-cookie':cookie('lp_session',sid,60*60*24*30)}});
  }
  if(req.method==='POST'&&p==='/api/logout'){const c=req.headers.get('Cookie')||'';const m=c.match(/(?:^|;\s*)lp_session=([^;]+)/);if(m)await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(m[1]).run();return new Response('',{status:204,headers:{'set-cookie':cookie('lp_session','',0)}})}
  if(req.method==='GET'&&p==='/api/me'){const a=await auth(req,env);if(!a)return json({authenticated:false},401);return json({authenticated:true,account:{id:a.id,email:a.email,business_name:a.business_name,plan:a.plan,status:a.status}})}
  if(req.method==='POST'&&p==='/api/onboarding'){
   const a=await auth(req,env);if(!a)return json({error:'Login required'},401);const b=await req.json();
   const token=id().replaceAll('-','');
   const existing=await env.DB.prepare('SELECT public_token FROM onboarding WHERE account_id=?').bind(a.id).first();
   await env.DB.prepare('INSERT OR REPLACE INTO onboarding(account_id,website,service,audience,phone,booking_url,tone,hours,public_token,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(a.id,clean(b.website,300),clean(b.service,200),clean(b.audience,300),clean(b.phone,80),clean(b.booking_url,300),clean(b.tone,50),clean(b.hours,200),existing?.public_token||token,now()).run();
   if(b.business_name)await env.DB.prepare('UPDATE accounts SET business_name=? WHERE id=?').bind(clean(b.business_name,160),a.id).run();
   return json({ok:true,public_token:existing?.public_token||token,embed_endpoint:`${u.origin}/api/leads/public`});
  }
  if(req.method==='GET'&&p==='/api/onboarding'){const a=await auth(req,env);if(!a)return json({error:'Login required'},401);const r=await env.DB.prepare('SELECT * FROM onboarding WHERE account_id=?').bind(a.id).first()||{};return json(r)}
  if(req.method==='POST'&&p==='/api/leads/public'){
   const b=await req.json();const token=clean(b.public_token,80);if(!token)return json({error:'public_token required'},400);
   const a=await env.DB.prepare('SELECT a.* FROM onboarding o JOIN accounts a ON a.id=o.account_id WHERE o.public_token=?').bind(token).first();if(!a)return json({error:'Invalid lead form token'},404);
   const email=clean(b.email,160);if(!clean(b.name,160)||(!email&&!clean(b.phone,80)))return json({error:'Name and either email or phone are required'},400);
   const l=id();const next=new Date(Date.now()+15*60*1000).toISOString();await env.DB.prepare('INSERT INTO leads(id,account_id,name,email,phone,message,next_followup_at,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(l,a.id,clean(b.name,160),email,clean(b.phone,80),clean(b.message,1000),next,now()).run();
   if(a.email)await sendEmail(env,a.email,'New LeadPilot lead',`New enquiry from ${clean(b.name,160)}${email?` (${email})`:''}${b.phone?` / ${clean(b.phone,80)}`:''}.\n\n${clean(b.message,1000)}`);
   return json({ok:true,lead_id:l,message:'Lead captured.'});
  }
  if(req.method==='POST'&&p==='/api/leads'){
   const a=await auth(req,env);if(!a)return json({error:'Login required'},401);const b=await req.json();const l=id();const next=new Date(Date.now()+15*60*1000).toISOString();
   await env.DB.prepare('INSERT INTO leads(id,account_id,name,email,phone,message,next_followup_at,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(l,a.id,clean(b.name,160),clean(b.email,160),clean(b.phone,80),clean(b.message,1000),next,now()).run();return json({ok:true,lead_id:l,message:'Lead captured.'});
  }
  if(req.method==='GET'&&p==='/api/leads'){const a=await auth(req,env);if(!a)return json({error:'Login required'},401);const r=await env.DB.prepare('SELECT * FROM leads WHERE account_id=? ORDER BY created_at DESC LIMIT 100').bind(a.id).all();return json(r.results||[])}
  if(req.method==='POST'&&p==='/api/create-checkout'){
   const a=await auth(req,env);if(!a)return json({error:'Login required'},401);const price=env.STRIPE_PRICE_ID;if(!price)return json({error:'Stripe is not configured yet. Add STRIPE_PRICE_ID.'},503);
   const r=await stripeApi(env,'checkout/sessions',{mode:'subscription',customer_email:a.email,'line_items[0][price]':price,'line_items[0][quantity]':'1',success_url:`${u.origin}/dashboard.html?paid=1`,cancel_url:`${u.origin}/dashboard.html?canceled=1`,'metadata[account_id]':a.id,'subscription_data[metadata][account_id]':a.id});
   if(!r.ok)return json({error:r.data?.error?.message||'Stripe checkout failed'},502);return json({url:r.data.url});
  }
  if(req.method==='POST'&&p==='/api/stripe-webhook'){
   const raw=await req.text();if(!(await verifyStripe(raw,req.headers.get('Stripe-Signature'),env.STRIPE_WEBHOOK_SECRET)))return json({error:'Invalid signature'},400);
   const e=JSON.parse(raw),obj=e.data?.object||{};let aid=obj.metadata?.account_id||null;const customer=obj.customer||null;
   if(!aid&&customer){const a=await env.DB.prepare('SELECT id FROM accounts WHERE stripe_customer_id=?').bind(customer).first();aid=a?.id||null}
   if(!aid&&e.type==='checkout.session.completed'&&obj.customer_email){const a=await env.DB.prepare('SELECT id FROM accounts WHERE email=?').bind(String(obj.customer_email).toLowerCase()).first();aid=a?.id||null}
   await env.DB.prepare('INSERT INTO events(account_id,type,payload,created_at) VALUES(?,?,?,?)').bind(aid,e.type,raw,now()).run();
   if(aid&&(e.type==='checkout.session.completed'||e.type==='customer.subscription.created'||e.type==='customer.subscription.updated'))await env.DB.prepare('UPDATE accounts SET plan=?,status=?,stripe_customer_id=COALESCE(?,stripe_customer_id),stripe_subscription_id=COALESCE(?,stripe_subscription_id) WHERE id=?').bind('starter','active',customer,obj.subscription||obj.id||null,aid).run();
   if(aid&&e.type==='customer.subscription.deleted')await env.DB.prepare('UPDATE accounts SET status=? WHERE id=?').bind('canceled',aid).run();
   if(aid&&e.type==='invoice.payment_failed')await env.DB.prepare('UPDATE accounts SET status=? WHERE id=?').bind('payment_failed',aid).run();
   return json({received:true});
  }
  return env.ASSETS.fetch(req);
 },
 async scheduled(event,env){
  const due=await env.DB.prepare("SELECT l.*,a.email as account_email,a.business_name,o.service,o.booking_url,o.tone FROM leads l JOIN accounts a ON a.id=l.account_id LEFT JOIN onboarding o ON o.account_id=l.account_id WHERE l.next_followup_at IS NOT NULL AND l.next_followup_at<=datetime('now') AND l.followup_count<3 AND l.status NOT IN ('converted','closed') AND a.status='active'").all();
  for(const l of due.results||[]){const sent=l.email?await sendEmail(env,l.email,'Following up on your enquiry',followupText(l,l)):false;const next=l.followup_count<2?new Date(Date.now()+24*60*60*1000).toISOString():null;await env.DB.prepare('UPDATE leads SET followup_count=followup_count+1,next_followup_at=?,status=? WHERE id=?').bind(next,sent?(next?'followup_sent':'followup_complete'):'followup_pending_send',l.id).run();}
 }
};
