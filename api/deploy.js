const crypto = require("crypto");

const MAX = 5 * 1024 * 1024;

function slugify(v) {
  return String(v || "").toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-").slice(0, 50);
}
function sha1(b) { return crypto.createHash("sha1").update(b).digest("hex"); }

async function uploadFile(buffer, digest) {
  const r = await fetch("https://api.vercel.com/v2/files", {
    method:"POST",
    headers:{
      Authorization:`Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type":"text/html",
      "Content-Length":String(buffer.length),
      "x-vercel-digest":digest
    },
    body:buffer
  });
  const t=await r.text();
  if(!r.ok) throw new Error(`Vercel upload gagal (${r.status}): ${t}`);
}

async function deploy(projectName,digest,size) {
  const r=await fetch("https://api.vercel.com/v13/deployments",{
    method:"POST",
    headers:{
      Authorization:`Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      name:projectName,
      target:"production",
      files:[{file:"index.html",sha:digest,size}]
    })
  });
  const d=await r.json();
  if(!r.ok)throw new Error(d?.error?.message||d?.message||"Vercel deployment gagal");
  return d;
}

async function telegram(project,fileName,html,url) {
  const form=new FormData();
  form.append("chat_id",process.env.TELEGRAM_CHAT_ID);
  form.append("caption",[
    "🚀 Dimzz Deploy",
    "",
    `Project: ${project}`,
    `Source: ${fileName}`,
    "Published: index.html",
    `URL: ${url}`
  ].join("\n"));
  form.append("document",new Blob([html],{type:"text/html"}),fileName||`${project}.html`);

  const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`,{
    method:"POST",body:form
  });
  const d=await r.json();
  if(!r.ok||!d.ok)throw new Error(d?.description||"Telegram gagal");
}

module.exports=async function(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS")return res.status(204).end();
  if(req.method!=="POST")return res.status(405).json({success:false,error:"POST /api/deploy only"});

  try{
    if(!process.env.VERCEL_TOKEN)throw new Error("VERCEL_TOKEN belum diset");
    if(!process.env.TELEGRAM_BOT_TOKEN)throw new Error("TELEGRAM_BOT_TOKEN belum diset");
    if(!process.env.TELEGRAM_CHAT_ID)throw new Error("TELEGRAM_CHAT_ID belum diset");

    const b=req.body||{};
    const project=slugify(b.projectName);
    const fileName=String(b.fileName||`${project}.html`).replace(/[^\w.-]/g,"_");
    const html=typeof b.html==="string"?b.html:"";

    if(!project)throw new Error("Nama project tidak valid");
    if(!html)throw new Error("HTML kosong");
    if(Buffer.byteLength(html,"utf8")>MAX)throw new Error("HTML maksimal 5 MB");
    if(!/<(?:!doctype\s+html|html[\s>])/i.test(html))throw new Error("File bukan HTML valid");

    const buffer=Buffer.from(html,"utf8");
    const digest=sha1(buffer);

    // Nama file asli tidak digunakan sebagai route.
    // Vercel menerima source tersebut dan manifest menunjuk ke index.html.
    await uploadFile(buffer,digest);
    const d=await deploy(project,digest,buffer.length);

    const aliases=Array.isArray(d.alias)?d.alias:[];
    const alias=aliases.find(x=>x===`${project}.vercel.app`)||aliases[0];
    const url=alias?`https://${alias}`:(d.url?`https://${d.url}`:`https://${project}.vercel.app`);

    let telegramSent=false,telegramError=null;
    try{await telegram(project,fileName,html,url);telegramSent=true}
    catch(e){telegramError=e.message}

    return res.status(200).json({
      success:true,projectName:project,sourceFile:fileName,publishedFile:"index.html",
      url,deploymentId:d.id||null,telegramSent,telegramError
    });
  }catch(e){
    console.error(e);
    return res.status(500).json({success:false,error:e.message||"Internal server error"});
  }
};
