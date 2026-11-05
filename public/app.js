const $=id=>document.getElementById(id);
const socket=io();
let currentRoom="",myName="",myAvatar=null;
const userIdKey="duochat-user-id";
let myUserId=localStorage.getItem(userIdKey);
if(!myUserId){myUserId="u_"+crypto.randomUUID().replaceAll("-","");localStorage.setItem(userIdKey,myUserId);}
const profiles=new Map();

const dbPromise=new Promise((resolve,reject)=>{
 const req=indexedDB.open("duochat-local",1);
 req.onupgradeneeded=()=>req.result.createObjectStore("messages",{keyPath:"id"});
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
async function save(msg){const db=await dbPromise;return new Promise(resolve=>{const tx=db.transaction("messages","readwrite");tx.objectStore("messages").put(msg);tx.oncomplete=resolve;});}
async function history(room){const db=await dbPromise;return new Promise(resolve=>{const r=db.transaction("messages").objectStore("messages").getAll();r.onsuccess=()=>resolve(r.result.filter(m=>m.room===room).sort((a,b)=>a.createdAt-b.createdAt));});}

function setAvatar(imgId, placeholderId, avatar) {
  const img = $(imgId);
  const placeholder = $(placeholderId);

  if (!img || !placeholder) return;

  if (avatar) {
    img.src = avatar;
    img.hidden = false;
    img.style.removeProperty("display");
    placeholder.hidden = true;
  } else {
    img.removeAttribute("src");
    img.hidden = true;
    img.style.setProperty("display", "none", "important");
    placeholder.hidden = false;
  }
}
function applyProfile(p){
 if(!p||!p.userId)return;
 profiles.set(p.userId,p);
 if(p.userId===myUserId){
  myName=p.name||myName;myAvatar=p.avatar||null;
  $("name").value=myName;
  $("profileName").textContent=myName;
  setAvatar("avatarPreview","avatarPlaceholder",myAvatar);
  setAvatar("chatAvatarPreview","chatAvatarPlaceholder",myAvatar);
 }
 // Update already rendered messages belonging to this profile.
 document.querySelectorAll(`[data-user-id="${CSS.escape(p.userId)}"] .message-avatar`).forEach(img=>{
  if(p.avatar){img.src=p.avatar;img.hidden=false;}else{img.hidden=true;}
 });
}

function render(msg){
 if(document.querySelector(`[data-id="${CSS.escape(msg.id)}"]`))return;

 const el=document.createElement("div");

 const isMine=msg.kind!=="ai" &&
  msg.kind!=="system" &&
  (msg.mine===true || msg.userId===myUserId);

 el.className="msg"+
  (isMine?" mine":"")+
  (msg.kind==="ai"?" ai-message":"")+
  (msg.kind==="system"?" system-message":"");

 el.style.setProperty("align-self",isMine?"flex-end":"flex-start","important");
 el.dataset.id=msg.id;

 if(msg.userId)el.dataset.userId=msg.userId;

 if(msg.kind!=="system"){
  const avatar=document.createElement("img");
  avatar.className="message-avatar";
  avatar.alt="";

  const profile=msg.userId?profiles.get(msg.userId):null;

  if(msg.kind==="ai"){
   avatar.classList.add("ai-avatar");
   avatar.src="data:image/svg+xml,"+encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g"><stop stop-color="#b78cff"/><stop offset="1" stop-color="#6742d4"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#g)"/><path d="M32 10l5.5 15L53 31l-15.5 5.5L32 52l-5.5-15.5L11 31l15.5-6z" fill="white"/></svg>'
   );
  }else if(profile?.avatar){
   avatar.src=profile.avatar;
  }else{
   avatar.hidden=true;
  }

  el.append(avatar);
 }

 const content=document.createElement("div");
 content.className="msg-content";

 const by=document.createElement("div");
 by.className="by";
 by.textContent=msg.kind==="ai"?"DuoChat AI":msg.name;

 const body=document.createElement("div");
 body.className="msg-text";
 body.textContent=msg.text;

 content.append(by,body);
 el.append(content);

 $("messages").append(el);
 $("messages").scrollTop=$("messages").scrollHeight;
}

async function enter(room){
 currentRoom=room.toUpperCase();myName=$("name").value.trim()||"Гость";
 $("setup").classList.add("hidden");$("chat").classList.remove("hidden");$("roomLabel").textContent=currentRoom;
 $("profileName").textContent=myName;$("messages").replaceChildren();
 (await history(currentRoom)).forEach(render);
 if(socket.connected)socket.emit("room:join",{room:currentRoom,name:myName,userId:myUserId,avatar:myAvatar});
}
socket.on("connect",()=>{$("connection").textContent="● онлайн";$("connection").style.color="#218653";if(currentRoom)socket.emit("room:join",{room:currentRoom,name:myName,userId:myUserId,avatar:myAvatar});});
socket.on("disconnect",()=>{$("connection").textContent="● нет связи";$("connection").style.color="#b34a4a";});
socket.on("room:history",async messages=>{for(const msg of messages||[]){await save(msg);render(msg);}});
socket.on("room:members",members=>{profiles.clear();for(const p of members||[])applyProfile(p);});
socket.on("profile:updated",applyProfile);
socket.on("profile:saved",applyProfile);
socket.on("chat:message",async msg=>{msg.room=currentRoom;await save(msg);render(msg);});
socket.on("member:joined",m=>{
 if(m.userId)applyProfile({userId:m.userId,name:m.name,avatar:m.avatar||null});
 render({id:crypto.randomUUID(),name:"Система",text:`${m.name} присоединился(ась)`,kind:"system",createdAt:Date.now()});
});
socket.on("member:left",m=>render({id:crypto.randomUUID(),name:"Система",text:`${m.name} вышел(ла)`,kind:"system",createdAt:Date.now()}));
socket.on("app:error",e=>alert(e.message));

async function makeJpeg(file){
 if(!file||!file.type.startsWith("image/"))throw new Error("Выбери файл изображения.");
 const bitmap=await createImageBitmap(file);
 const size=320,scale=Math.min(1,size/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 const ctx=canvas.getContext("2d");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.78));
 if(!blob)throw new Error("Не удалось обработать фотографию.");
 if(blob.size>180*1024)throw new Error("Фото получилось слишком большим. Выбери другое изображение.");
 return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
}
async function chooseAvatar(input){
 const file=input.files?.[0];if(!file)return;
 try{
  myAvatar=await makeJpeg(file);
  setAvatar("avatarPreview","avatarPlaceholder",myAvatar);
  setAvatar("chatAvatarPreview","chatAvatarPlaceholder",myAvatar);
  if(currentRoom&&socket.connected)socket.emit("profile:update",{name:myName,avatar:myAvatar});
 }catch(e){alert(e.message||"Не удалось загрузить фото.");}
 input.value="";
}
$("avatarButton").onclick=()=>$("avatarFile").click();
$("chatAvatarButton").onclick=()=>$("chatAvatarFile").click();
$("avatarFile").onchange=()=>chooseAvatar($("avatarFile"));
$("chatAvatarFile").onchange=()=>chooseAvatar($("chatAvatarFile"));

$("create").onclick=()=>{const room="DUO"+Math.random().toString(36).slice(2,7).toUpperCase();$("room").value=room;enter(room);};
$("join").onclick=()=>{const room=$("room").value.trim();if(!/^[A-Z0-9]{6,12}$/i.test(room))return alert("Код должен содержать 6–12 латинских букв или цифр.");enter(room);};
$("send").onclick=async()=>{
 const text=$("text").value.trim();if(!text||!currentRoom)return;
 if(!socket.connected)return alert("Нет соединения. Сообщение пока не отправлено.");
 const msg={id:crypto.randomUUID(),text,name:myName,createdAt:Date.now(),kind:"user",room:currentRoom,userId:myUserId,mine:true};
 await save(msg);render(msg);socket.emit("chat:message",msg);$("text").value="";
};
$("text").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("send").click();}});
$("copy").onclick=async()=>{try{await navigator.clipboard.writeText(currentRoom);$("copy").textContent="Скопировано!";}catch{alert("Код комнаты: "+currentRoom);}};
$("leave").onclick=()=>{currentRoom="";$("chat").classList.add("hidden");$("setup").classList.remove("hidden");};
$("askAI").onclick=async()=>{
 const btn=$("askAI");btn.disabled=true;btn.textContent="ИИ думает…";
 try{
  const msgs=await history(currentRoom);
  const r=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:"Ты дружелюбный русскоязычный помощник в общем чате друзей. Отвечай по контексту."},...msgs.filter(m=>m.kind==="user").slice(-15).map(m=>({role:"user",content:`${m.name}: ${m.text}`})),{role:"user",content:"Ответь на переписку."}]})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||"Ошибка ИИ");
  const msg={id:crypto.randomUUID(),room:currentRoom,name:"DuoChat AI",text:data.text,createdAt:Date.now(),kind:"ai"};
  await save(msg);render(msg);socket.emit("chat:ai",msg);
 }catch(e){alert(e.message);}finally{btn.disabled=false;btn.textContent="✧ Спросить ИИ по переписке";}
};
const settingsButton=$("settingsButton");
const settingsPanel=$("settingsPanel");
const bgOpacity=$("bgOpacity");
const opacityValue=$("opacityValue");

function setOpacity(value){
  document.documentElement.style.setProperty("--bg-opacity",value/100);
  opacityValue.textContent=value+"%";
  localStorage.setItem("bgOpacity",value);
}

bgOpacity.value=localStorage.getItem("bgOpacity")||50;
setOpacity(bgOpacity.value);

settingsButton.onclick=()=>{
  $("setup").classList.add("hidden");
  $("chat").classList.add("hidden");
  settingsPanel.classList.remove("hidden");
};

$("closeSettings").onclick=()=>{
  settingsPanel.classList.add("hidden");
  if(currentRoom){
    $("chat").classList.remove("hidden");
  }else{
    $("setup").classList.remove("hidden");
  }
};

bgOpacity.oninput=()=>setOpacity(bgOpacity.value);
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js");
