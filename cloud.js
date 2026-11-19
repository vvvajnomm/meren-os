/* Meren OS: private Supabase workspace sync layer */
(() => {
'use strict';
const form = document.getElementById('cloud-auth-form');
const msg = document.getElementById('cloud-message');
const submit = document.getElementById('cloud-submit');
const toggle = document.getElementById('cloud-switch');
const email = document.getElementById('cloud-email');
const pass = document.getElementById('cloud-password');
let signup = false, client = null, user = null, lastRemote = null, pending = false;
let saving = false, dirty = false, rev = 0, timer = null, polling = null;
let busyAuth = false, loading = false;
const show = s => { msg.textContent = s || ''; };
const emptyState = () => ({tasks:[],shifts:[],suppliers:[],files:[]});
const clean = obj => ({
 tasks: Array.isArray(obj?.tasks) ? obj.tasks : [],
 shifts: Array.isArray(obj?.shifts) ? obj.shifts : [],
 suppliers: Array.isArray(obj?.suppliers) ? obj.suppliers : [],
 files: Array.isArray(obj?.files) ? obj.files : []
});
const indicator = document.createElement('div');
indicator.id='cloud-indicator';
const foot = document.querySelector('.aside-foot');
if (foot) foot.appendChild(indicator);
function status(label,cls='sync-warn'){
 const span = document.createElement('span');
 span.className = cls;
 span.textContent = '● ' + label;
 const quit = document.createElement('button');
 quit.textContent = 'Выйти';
 quit.title = 'Выйти из аккаунта';
 quit.onclick = async()=>{
   if(dirty||saving){if(!confirm('Не все данные синхронизированы. Выйти всё равно?'))return;}
   clearTimeout(timer); dirty=false; pending=false;
   if(client) await client.auth.signOut();
   user=null; document.body.classList.remove('cloud-ready'); show('');
 };
 indicator.replaceChildren(span,quit);
}
function setReady(ready){document.body.classList.toggle('cloud-ready', ready);}
function localBackup(){
 try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){console.warn('Local backup failed',e);}
}
function takeRemote(obj,updated){
 state=clean(obj);
 lastRemote=updated||null;
 localBackup();
 render();
}
async function load(){
 if(!user)return;
 status('Загружаем данные...');
 const {data,error}=await client.from('meren_workspaces').select('data,updated_at').eq('user_id',user.id).maybeSingle();
 if(error)throw error;
 if(data){takeRemote(data.data,data.updated_at)}
 else{
   const fresh = emptyState();
   const timestamp=new Date().toISOString();
   const result=await client.from('meren_workspaces').upsert({user_id:user.id,data:fresh,updated_at:timestamp},{onConflict:'user_id'});
   if(result.error)throw result.error;
   takeRemote(fresh,timestamp);
 }
 dirty=false; pending=false;
 setReady(true);
 status('Синхронизировано','sync-ok');
}
function queueSave(){
 if(!user || !document.body.classList.contains('cloud-ready'))return;
 dirty=true; rev++;
 status('Сохраняем...');
 clearTimeout(timer);
 timer=setTimeout(flush,550);
}
window.merenCloudSave=queueSave;
async function flush(){
 if(!user || saving || !dirty)return;
 saving=true; dirty=false;
 const atRev=rev;
 const stamp=new Date().toISOString();
 const snapshot=clean(state);
 try {
   const {error}=await client.from('meren_workspaces').upsert({user_id:user.id,data:snapshot,updated_at:stamp},{onConflict:'user_id'});
   if(error)throw error;
   lastRemote=stamp;
   if(!dirty && atRev===rev)status('Синхронизировано','sync-ok');
 }catch(e){
   dirty=true;
   status('Ошибка сети — повторим','sync-error');
   console.warn('Cloud save failed',e);
 } finally {
   saving=false;
   if(dirty){clearTimeout(timer);timer=setTimeout(flush,2000);}
 }
}
async function poll(){
 if(!user || dirty || saving || pending || !document.body.classList.contains('cloud-ready'))return;
 const modalOpen=document.getElementById('modal')?.classList.contains('show');
 if(modalOpen)return;
 if(document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
 pending=true;
 try{
   const {data,error}=await client.from('meren_workspaces').select('data,updated_at').eq('user_id',user.id).maybeSingle();
   if(error)throw error;
   if(data && data.updated_at!==lastRemote){
     takeRemote(data.data,data.updated_at);
     status('Данные обновлены','sync-ok');
   }
 }catch(e){status('Нет связи — ждём сеть','sync-error');}
 finally{pending=false;}
}
async function loggedIn(session){
 if(!session?.user || loading)return;
 if(user?.id===session.user.id && document.body.classList.contains('cloud-ready'))return;
 loading=true; user=session.user;
 show('Подключаем твои данные...');
 try{await load();}
 catch(e){setReady(false);show('Не удалось загрузить базу: '+e.message+'\nПроверь setup.sql и настройки Supabase.');}
 finally{loading=false;}
}
async function initialize(){
 const url=String(window.MEREN_SUPABASE_URL||'');
 const key=String(window.MEREN_SUPABASE_KEY||'');
 if(!url.startsWith('https://')||url.includes('PASTE_')||!key||key.includes('PASTE_')){
   show('Сначала впиши Project URL и Publishable key в config.js на GitHub, затем обнови страницу.');
   return;
 }
 if(!window.supabase?.createClient){show('Не загрузилась библиотека Supabase. Проверь интернет и обнови страницу.');return;}
 try{
   client=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
   const {data,error}=await client.auth.getSession();
   if(error)throw error;
   if(data.session)await loggedIn(data.session);
   else show('Войди или создай аккаунт — тогда задачи появятся на обоих устройствах.');
   client.auth.onAuthStateChange((event,session)=>{
     if(event==='SIGNED_OUT'){user=null;setReady(false);status('Выход выполнен');return;}
     if(session?.user && event==='SIGNED_IN' && !document.body.classList.contains('cloud-ready')){
       // Run outside auth callback to avoid deadlocks in the auth client.
       setTimeout(()=>loggedIn(session),0);
     }
   });
   polling=setInterval(poll,8000);
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
   window.addEventListener('online',()=>{if(dirty)flush(); else poll();});
 }catch(e){show('Ошибка подключения: '+e.message);}
}
function updateMode(){
 submit.textContent=signup?'Создать аккаунт':'Войти';
 toggle.textContent=signup?'Уже есть аккаунт? Войти':'Первый раз? Создать аккаунт';
 pass.autocomplete=signup?'new-password':'current-password';
 show('');
}
toggle.addEventListener('click',()=>{signup=!signup;updateMode()});
form.addEventListener('submit', async e=>{
 e.preventDefault(); if(!client || busyAuth)return;
 busyAuth=true;submit.disabled=true;
 const credentials={email:email.value.trim(),password:pass.value};
 show(signup?'Создаём аккаунт...':'Выполняем вход...');
 try {
   if(signup){
     const {data,error}=await client.auth.signUp({...credentials,options:{emailRedirectTo:location.origin+location.pathname}});
     if(error)throw error;
     if(data.session) await loggedIn(data.session);
     else show('Проверь письмо от Supabase и подтверди почту. Потом вернись сюда и войди.');
   }else{
     const {data,error}=await client.auth.signInWithPassword(credentials);
     if(error)throw error;
     await loggedIn(data.session);
   }
 }catch(e){show('Ошибка: '+e.message+'\nПроверь почту, пароль и подтверждение регистрации.');}
 finally{busyAuth=false;submit.disabled=false;}
});
initialize();
})();
