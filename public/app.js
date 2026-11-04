const $=id=>document.getElementById(id);
const socket=io();
let currentRoom="",myName="";
const dbPromise=new Promise((resolve,reject)=>{
 const req=indexedDB.open("duochat-local",1);
 req.onupgradeneeded=()=>req.result.createObjectStore("messages",{keyPath:"id"});
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
async function save(msg){const db=await dbPromise;return new Promise(resolve=>{const tx=db.transaction("messages","readwrite");tx.objectStore("messages").put(msg);tx.oncomplete=resolve;});}
async function history(room){const db=await dbPromise;return new Promise(resolve=>{const r=db.transaction("messages").objectStore("messages").getAll();r.onsuccess=()=>resolve(r.result.filter(m=>m.room===room).sort((a,b)=>a.createdAt-b.createdAt));});}
function render(msg){if(document.querySelector(`[data-id="${CSS.escape(msg.id)}"]`))return;
 const el=document.createElement("div");el.className="msg"+(msg.name===myName?" mine":"");el.dataset.id=msg.id;
 const by=document.createElement("div");by.className="by";by.textContent=msg.kind==="ai"?"DuoChat AI":msg.name;
 const body=document.createElement("div");body.textContent=msg.text;el.append(by,body);$("messages").append(el);$("messages").scrollTop=$("messages").scrollHeight;}
async function enter(room){currentRoom=room.toUpperCase();myName=$("name").value.trim()||"Гость";
 $("setup").classList.add("hidden");$("chat").classList.remove("hidden");$("roomLabel").textContent=currentRoom;$("messages").replaceChildren();
 (await history(currentRoom)).forEach(render);if(socket.connected)socket.emit("room:join",{room:currentRoom,name:myName});}
socket.on("connect",()=>{$("connection").textContent="● онлайн";$("connection").style.color="#218653";if(currentRoom)socket.emit("room:join",{room:currentRoom,name:myName});});
socket.on("disconnect",()=>{$("connection").textContent="● нет связи";$("connection").style.color="#b34a4a";});
socket.on("room:history",async messages=>{for(const msg of messages||[]){await save(msg);render(msg);}});
socket.on("chat:message",async msg=>{msg.room=currentRoom;await save(msg);render(msg);});
socket.on("member:joined",m=>render({id:crypto.randomUUID(),name:"Система",text:`${m.name} присоединился(ась)`,kind:"system",createdAt:Date.now()}));
socket.on("member:left",m=>render({id:crypto.randomUUID(),name:"Система",text:`${m.name} вышел(ла)`,kind:"system",createdAt:Date.now()}));
socket.on("app:error",e=>alert(e.message));
$("create").onclick=()=>{const room="DUO"+Math.random().toString(36).slice(2,7).toUpperCase();$("room").value=room;enter(room);};
$("join").onclick=()=>{const room=$("room").value.trim();if(!/^[A-Z0-9]{6,12}$/i.test(room))return alert("Код должен содержать 6–12 латинских букв или цифр.");enter(room);};
$("send").onclick=async()=>{const text=$("text").value.trim();if(!text||!currentRoom)return;if(!socket.connected)return alert("Нет соединения. Сообщение пока не отправлено.");
 const msg={id:crypto.randomUUID(),text,name:myName,createdAt:Date.now(),kind:"user",room:currentRoom};await save(msg);render(msg);socket.emit("chat:message",msg);$("text").value="";};
$("text").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("send").click();}});
$("copy").onclick=async()=>{try{await navigator.clipboard.writeText(currentRoom);$("copy").textContent="Скопировано!";}catch{alert("Код комнаты: "+currentRoom);}};
$("leave").onclick=()=>{currentRoom="";$("chat").classList.add("hidden");$("setup").classList.remove("hidden");};
$("askAI").onclick=async()=>{const btn=$("askAI");btn.disabled=true;btn.textContent="ИИ думает…";try{
 const msgs=await history(currentRoom);const r=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:"Ты дружелюбный русскоязычный помощник в общем чате друзей. Отвечай по контексту."},...msgs.filter(m=>m.kind==="user").slice(-15).map(m=>({role:"user",content:`${m.name}: ${m.text}`})),{role:"user",content:"Ответь на переписку."}]})});
 const data=await r.json();if(!r.ok)throw new Error(data.error||"Ошибка ИИ");const msg={id:crypto.randomUUID(),room:currentRoom,name:"DuoChat AI",text:data.text,createdAt:Date.now(),kind:"ai"};await save(msg);render(msg);
 // AI response is sent to other participants using a dedicated relay event.
 socket.emit("chat:ai",msg);
 }catch(e){alert(e.message);}finally{btn.disabled=false;btn.textContent="Спросить ИИ по переписке";}};

if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
