import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const { Pool } = pg;
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(); app.use(express.json({limit:"32kb"}));
app.disable("x-powered-by");
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("X-Frame-Options","DENY");
  next();
});
app.use(express.static(path.join(__dirname,"public")));
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:process.env.ALLOWED_ORIGIN?.split(",")||true}});
const validRoom=s=>typeof s==="string"&&/^[A-Z0-9]{6,12}$/.test(s);
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false},max:5,idleTimeoutMillis:30000,connectionTimeoutMillis:10000}):null;
let dbReady=false;
async function initDb(){
 if(!pool) throw new Error("DATABASE_URL не задана. Добавьте строку подключения PostgreSQL в Render Environment.");
 await pool.query(`CREATE TABLE IF NOT EXISTS chat_messages (
   id TEXT PRIMARY KEY,
   room VARCHAR(12) NOT NULL,
   name VARCHAR(32) NOT NULL,
   message TEXT NOT NULL,
   created_at BIGINT NOT NULL,
   kind VARCHAR(12) NOT NULL CHECK (kind IN ('user','ai'))
 )`);
 await pool.query("CREATE INDEX IF NOT EXISTS chat_messages_room_time_idx ON chat_messages(room, created_at)");
 dbReady=true; console.log("DuoChat database ready");
}
async function storeMessage(msg){
 if(!dbReady) throw new Error("База истории ещё не подключена.");
 await pool.query(`INSERT INTO chat_messages(id,room,name,message,created_at,kind)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,[msg.id,msg.room,msg.name,msg.text,msg.createdAt,msg.kind]);
 // Keep the latest 2,000 messages per room to limit free database usage.
 await pool.query(`DELETE FROM chat_messages WHERE room=$1 AND id IN (
   SELECT id FROM chat_messages WHERE room=$1 ORDER BY created_at DESC OFFSET 2000
 )`,[msg.room]);
}
async function loadHistory(room){
 if(!dbReady) return [];
 const {rows}=await pool.query(`SELECT id,room,name,message AS text,created_at AS "createdAt",kind
 FROM chat_messages WHERE room=$1 ORDER BY created_at ASC LIMIT 2000`,[room]);
 return rows.map(r=>({...r,createdAt:Number(r.createdAt)}));
}
io.on("connection",socket=>{
 socket.on("room:join",async({room,name}={})=>{
  room=String(room||"").toUpperCase();
  if(!validRoom(room)) return socket.emit("app:error",{message:"Неверный код комнаты."});
  if(!dbReady) return socket.emit("app:error",{message:"База истории ещё не подключена. Проверьте DATABASE_URL в Render."});
  const roomMembers=io.sockets.adapter.rooms.get(room);
  if(roomMembers && roomMembers.size>=10) return socket.emit("app:error",{message:"В комнате максимум 10 участников."});
  socket.join(room); socket.data.room=room;
  socket.data.name=String(name||"Гость").slice(0,32);
  try{
   const messages=await loadHistory(room);
   socket.emit("room:ready",{room,members:io.sockets.adapter.rooms.get(room)?.size||1});
   socket.emit("room:history",messages);
   socket.to(room).emit("member:joined",{name:socket.data.name});
  }catch(e){console.error("History load failed",e);socket.emit("app:error",{message:"Не удалось загрузить историю комнаты."});}
 });
 socket.on("chat:ai",async payload=>{
  const room=socket.data.room;
  if(!room||!payload||typeof payload.text!=="string") return;
  const msg={id:String(payload.id||Date.now()),room,text:payload.text.slice(0,4000),name:"DuoChat AI",createdAt:Number(payload.createdAt)||Date.now(),kind:"ai"};
  try{await storeMessage(msg);socket.to(room).emit("chat:message",msg);}catch(e){console.error("AI message save failed",e);socket.emit("app:error",{message:"Ответ ИИ не удалось сохранить."});}
 });
 socket.on("chat:message",async payload=>{
  const room=socket.data.room;
  if(!room||!payload||typeof payload.text!=="string") return;
  const msg={id:String(payload.id||Date.now()),room,text:payload.text.slice(0,4000),name:socket.data.name,createdAt:Number(payload.createdAt)||Date.now(),kind:"user"};
  try{await storeMessage(msg);socket.to(room).emit("chat:message",msg);}catch(e){console.error("Message save failed",e);socket.emit("app:error",{message:"Сообщение не удалось сохранить. Попробуйте ещё раз."});}
 });
 socket.on("disconnect",()=>{if(socket.data.room)socket.to(socket.data.room).emit("member:left",{name:socket.data.name});});
});
app.post("/api/ai",async(req,res)=>{
 const {AI_BASE_URL,AI_API_KEY}=process.env, model=process.env.AI_MODEL||"openai/gpt-oss-20b";
 if(!AI_BASE_URL||!AI_API_KEY) return res.status(503).json({error:"ИИ не подключён. Администратору сервера нужно настроить API."});
 const messages=Array.isArray(req.body?.messages)?req.body.messages.slice(-20):[];
 try{
  const r=await fetch(`${AI_BASE_URL.replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${AI_API_KEY}`},body:JSON.stringify({model,messages})});
  const data=await r.json();
  if(!r.ok)return res.status(502).json({error:data?.error?.message||"Ошибка провайдера ИИ."});
  res.json({text:data.choices?.[0]?.message?.content||"Нет ответа от ИИ."});
 }catch{return res.status(502).json({error:"Не удалось связаться с ИИ."});}
});
app.get("/health",(_,res)=>res.json({ok:true,service:"DuoChat",version:"0.4.0",history:dbReady?"persistent":"not-configured"}));
const port=Number(process.env.PORT||3000);
initDb().then(()=>server.listen(port,"0.0.0.0",()=>console.log(`DuoChat listening on ${port}`))).catch(err=>{console.error("Database initialization failed:",err);process.exit(1);});
