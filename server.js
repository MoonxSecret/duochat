import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const rooms=new Map(); // Ephemeral relay only; no message bodies persisted on server.
const validRoom=s=>typeof s==="string"&&/^[A-Z0-9]{6,12}$/.test(s);
io.on("connection",socket=>{
  socket.on("room:join",({room,name}={})=>{
    room=String(room||"").toUpperCase();
    if(!validRoom(room)) return socket.emit("app:error",{message:"Неверный код комнаты."});
    const roomMembers=io.sockets.adapter.rooms.get(room);
    if(roomMembers && roomMembers.size>=10) return socket.emit("app:error",{message:"В комнате максимум 10 участников."});
    socket.join(room); socket.data.room=room;
    socket.data.name=String(name||"Гость").slice(0,32);
    const members=io.sockets.adapter.rooms.get(room)?.size||1;
    socket.emit("room:ready",{room,members});
    socket.to(room).emit("member:joined",{name:socket.data.name});
  });
  socket.on("chat:ai",payload=>{
    const room=socket.data.room;
    if(!room||!payload||typeof payload.text!=="string") return;
    socket.to(room).emit("chat:message",{id:String(payload.id||Date.now()),room,
      text:payload.text.slice(0,4000),name:"DuoChat AI",createdAt:Number(payload.createdAt)||Date.now(),kind:"ai"});
  });
  socket.on("chat:message",payload=>{
    const room=socket.data.room;
    if(!room||!payload||typeof payload.text!=="string") return;
    const msg={id:String(payload.id||Date.now()),room,text:payload.text.slice(0,4000),
      name:socket.data.name,createdAt:Number(payload.createdAt)||Date.now(),kind:"user"};
    socket.to(room).emit("chat:message",msg); // sender already rendered locally
  });
  socket.on("disconnect",()=>{
    if(socket.data.room) socket.to(socket.data.room).emit("member:left",{name:socket.data.name});
  });
});
app.post("/api/ai",async(req,res)=>{
  const {AI_BASE_URL,AI_API_KEY}=process.env, model=process.env.AI_MODEL||"gpt-4o-mini";
  if(!AI_BASE_URL||!AI_API_KEY) return res.status(503).json({error:"ИИ не подключён. Администратору сервера нужно настроить API."});
  const messages=Array.isArray(req.body?.messages)?req.body.messages.slice(-20):[];
  try{
    const r=await fetch(`${(AI_BASE_URL.endsWith("/") ? AI_BASE_URL.slice(0,-1) : AI_BASE_URL)}/chat/completions`,{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${AI_API_KEY}`},
      body:JSON.stringify({model,messages})
    });
    const data=await r.json();
    if(!r.ok) return res.status(502).json({error:data?.error?.message||"Ошибка провайдера ИИ."});
    res.json({text:data.choices?.[0]?.message?.content||"Нет ответа от ИИ."});
  }catch{return res.status(502).json({error:"Не удалось связаться с ИИ."});}
});
app.get("/health",(_,res)=>res.json({ok:true,service:"DuoChat",version:"0.2.0"}));
const port=Number(process.env.PORT||3000);
server.listen(port,"0.0.0.0",()=>console.log(`DuoChat listening on ${port}`));
