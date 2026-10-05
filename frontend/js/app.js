const CONFIG={freeShipping:100,shippingCost:4.9}; // même règle que le serveur (le serveur a le dernier mot)
const ICONS={
 shirt:'<svg viewBox="0 0 100 100"><path d="M30 12l-22 14 8 16 12-6v46h44V36l12 6 8-16-22-14c-3 8-9 12-20 12s-17-4-20-12z"/></svg>',
 pants:'<svg viewBox="0 0 100 100"><path d="M28 8h44l6 84H55L50 40l-5 52H22z"/></svg>',
 coat:'<svg viewBox="0 0 100 100"><path d="M32 8l-20 12 4 70h26V30l8 6 8-6v60h26l4-70L68 8c-3 10-9 14-18 14S35 18 32 8z"/></svg>'};
const SIZES=["XS","S","M","L","XL"];
const STATUS={pending:"En attente",paid:"Payée",shipped:"Expédiée",cancelled:"Annulée"};
const fmt=n=>n.toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let PRODUCTS=[],cart=[],filter="Tout",token=null,user=null,mode="login",afterAuth=null;
try{cart=JSON.parse(localStorage.getItem("cart")||"[]");token=localStorage.getItem("token")}catch(e){}
const saveCart=()=>{try{localStorage.setItem("cart",JSON.stringify(cart))}catch(e){}};

async function api(path,opts={}){
  const r=await fetch("/api"+path,{...opts,
    headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
    body:opts.body?JSON.stringify(opts.body):undefined});
  const data=r.status===204?null:await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(data.error||"Erreur "+r.status);e.status=r.status;throw e}
  return data;
}
function setSession(t,u){
  token=t;user=u;
  try{t?localStorage.setItem("token",t):localStorage.removeItem("token")}catch(e){}
  $("#accBtn").textContent=u?"Mes commandes":"Connexion";
  $("#logoutBtn").hidden=!u;
}

async function init(){
  try{PRODUCTS=await api("/products")}
  catch(e){$("#catalogue").innerHTML='<p class="nores">Impossible de charger les produits. Vérifiez que les 3 conteneurs tournent (docker compose ps).</p>';return}
  if(token){try{setSession(token,(await api("/auth/me")).user)}catch(e){setSession(null,null)}}
  cart=cart.filter(l=>PRODUCTS.some(p=>p.id===l.id));
  renderFilters();renderGrid();update();
}

// ---------- Catalogue ----------
function renderFilters(){
  const cats=["Tout",...new Set(PRODUCTS.map(p=>p.cat))];
  $("#filters").innerHTML=cats.map(c=>`<button aria-pressed="${c===filter}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
  $("#filters").querySelectorAll("button").forEach(b=>b.onclick=()=>{filter=b.dataset.c;renderFilters();renderGrid()});
}
function renderGrid(){
  const q=$("#search").value.trim().toLowerCase(),s=$("#sort").value;
  let list=PRODUCTS.filter(p=>(filter==="Tout"||p.cat===filter)&&(p.name+" "+p.color).toLowerCase().includes(q));
  if(s==="asc")list.sort((a,b)=>a.price-b.price);
  if(s==="desc")list.sort((a,b)=>b.price-a.price);
  if(s==="name")list.sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  $("#catalogue").innerHTML=list.length?list.map(p=>`
  <article class="card">
    <div class="visual" style="background:${esc(p.bg)}">${ICONS[p.icon]||""}${p.tag?`<span class="tag">${esc(p.tag)}</span>`:""}</div>
    <h3>${esc(p.name)}</h3><div class="meta">${esc(p.color)}</div>
    <div class="row"><span class="price">${fmt(p.price)}</span>
      <select id="size${p.id}" aria-label="Taille de ${esc(p.name)}">${SIZES.map(z=>`<option ${z==="M"?"selected":""}>${z}</option>`).join("")}</select></div>
    <button class="add" data-id="${p.id}">Ajouter au panier</button>
  </article>`).join(""):'<p class="nores">Aucun article ne correspond à votre recherche.</p>';
  document.querySelectorAll(".add").forEach(b=>b.onclick=()=>add(+b.dataset.id));
}

// ---------- Panier ----------
function add(id){
  const size=$("#size"+id).value,l=cart.find(x=>x.id===id&&x.size===size);
  l?l.qty++:cart.push({id,size,qty:1});
  update();toast("Ajouté au panier");
}
function change(i,d){cart[i].qty+=d;if(cart[i].qty<=0)cart.splice(i,1);update()}
function totals(){
  const sub=cart.reduce((a,l)=>a+l.qty*PRODUCTS.find(x=>x.id===l.id).price,0);
  const ship=!cart.length||sub>=CONFIG.freeShipping?0:CONFIG.shippingCost;
  return{sub,ship,total:sub+ship};
}
function update(){
  saveCart();
  const {sub,ship,total}=totals();
  $("#count").textContent=cart.reduce((a,l)=>a+l.qty,0);
  $("#items").innerHTML=cart.length?cart.map((l,i)=>{
    const p=PRODUCTS.find(x=>x.id===l.id);
    return `<div class="line"><div class="sw" style="background:${esc(p.bg)}"></div>
    <div class="info"><strong>${esc(p.name)}</strong><br><span class="meta">Taille ${esc(l.size)} · ${fmt(p.price)}</span></div>
    <div class="qty"><button data-i="${i}" data-d="-1" aria-label="Retirer un">−</button>${l.qty}<button data-i="${i}" data-d="1" aria-label="Ajouter un">+</button></div></div>`}).join("")
    :'<p class="empty">Votre panier est vide. Choisissez une taille puis ajoutez un article.</p>';
  $("#items").querySelectorAll(".qty button").forEach(b=>b.onclick=()=>change(+b.dataset.i,+b.dataset.d));
  const left=CONFIG.freeShipping-sub;
  $("#ship").innerHTML=cart.length?(left>0?`Plus que <strong>${fmt(left)}</strong> pour la livraison offerte`:"<strong>Livraison offerte</strong>")+`<div class="bar"><i style="width:${Math.min(100,sub/CONFIG.freeShipping*100)}%"></i></div>`:"";
  $("#shipcost").textContent=cart.length?(ship?fmt(ship):"Offerte"):"–";
  $("#total").textContent=fmt(total);
}

// ---------- Compte ----------
function setMode(m){
  mode=m;const reg=m==="register";
  $("#nameRow").hidden=!reg;$("#aName").required=reg;
  $("#authTitle").textContent=reg?"Créer un compte":"Connexion";
  $("#authSubmit").textContent=reg?"Créer mon compte":"Se connecter";
  $("#tabLogin").setAttribute("aria-pressed",!reg);$("#tabReg").setAttribute("aria-pressed",reg);
  $("#aPass").autocomplete=reg?"new-password":"current-password";
}
function openAuth(m="login",note=""){setMode(m);$("#authNote").textContent=note;$("#authErr").textContent="";$("#authDlg").showModal()}
$("#tabLogin").onclick=()=>setMode("login");
$("#tabReg").onclick=()=>setMode("register");
$("#authDlg").onclose=()=>{afterAuth=null};
$("#authForm").onsubmit=async e=>{
  e.preventDefault();$("#authErr").textContent="";
  const body={email:$("#aEmail").value,password:$("#aPass").value};
  if(mode==="register")body.name=$("#aName").value;
  try{
    const r=await api("/auth/"+mode,{method:"POST",body});
    setSession(r.token,r.user);
    const next=afterAuth;afterAuth=null;
    $("#authDlg").close();$("#authForm").reset();
    toast(mode==="register"?"Compte créé":"Connecté");
    if(next)next();
  }catch(err){$("#authErr").textContent=err.message}
};
$("#logoutBtn").onclick=()=>{setSession(null,null);toast("Déconnecté")};
$("#accBtn").onclick=()=>user?openOrders():openAuth();

// ---------- Commande ----------
function openCheckout(){
  toggle(false);
  const {total}=totals();
  $("#coSum").textContent=`${cart.reduce((a,l)=>a+l.qty,0)} article(s) · Total ${fmt(total)}`;
  if(!$("#cName").value)$("#cName").value=user.name;
  $("#coErr").textContent="";$("#coForm").hidden=false;$("#coDone").hidden=true;
  $("#coDlg").showModal();
}
$("#pay").onclick=()=>{
  if(!cart.length)return toast("Le panier est vide");
  if(!user){afterAuth=openCheckout;toggle(false);return openAuth("login","Connectez-vous ou créez un compte pour commander.")}
  openCheckout();
};
$("#coForm").onsubmit=async e=>{
  e.preventDefault();$("#coErr").textContent="";$("#coSubmit").disabled=true;
  try{
    const r=await api("/orders",{method:"POST",body:{
      items:cart.map(({id,size,qty})=>({id,size,qty})),
      address:{name:$("#cName").value,address:$("#cAddr").value,zip:$("#cZip").value,city:$("#cCity").value}}});
    cart=[];update();
    $("#coForm").hidden=true;$("#coDone").hidden=false;
    $("#coDone").innerHTML=`<p class="ok">Commande n°${r.id} enregistrée</p>
      <p>Total : <strong>${fmt(r.total)}</strong> (livraison ${r.shipping?fmt(r.shipping):"offerte"}).</p>
      <p class="meta">Version de test : aucun paiement n'a été effectué.</p>`;
    api("/products").then(p=>{PRODUCTS=p;renderGrid()}).catch(()=>{});
  }catch(err){
    if(err.status===401){setSession(null,null);$("#coDlg").close();afterAuth=openCheckout;openAuth("login","Votre session a expiré, reconnectez-vous.")}
    else $("#coErr").textContent=err.message;
  }finally{$("#coSubmit").disabled=false}
};

async function openOrders(){
  $("#delForm").hidden=true;$("#delBtn").hidden=false;$("#delErr").textContent="";
  $("#ordTitle").textContent="Commandes de "+user.name;
  $("#ordList").innerHTML='<p class="meta">Chargement…</p>';$("#ordDlg").showModal();
  try{
    const list=await api("/orders");
    $("#ordList").innerHTML=list.length?list.map(o=>`<div class="ord">
      <div class="row"><strong>Commande n°${o.id}</strong><span class="meta">${new Date(o.created_at).toLocaleDateString("fr-FR")} · ${esc(STATUS[o.status]||o.status)}</span></div>
      ${o.items.map(i=>`<div class="meta">${i.qty} × ${esc(i.name)} (${esc(i.size)})</div>`).join("")}
      <div class="price">${fmt(o.total)}</div></div>`).join(""):'<p class="empty">Aucune commande pour le moment.</p>';
  }catch(e){
    if(e.status===401){setSession(null,null);$("#ordDlg").close();openAuth("login","Votre session a expiré, reconnectez-vous.")}
    else $("#ordList").textContent=e.message;
  }
}

$("#delBtn").onclick=()=>{$("#delForm").hidden=false;$("#delBtn").hidden=true};
$("#delForm").onsubmit=async e=>{
  e.preventDefault();$("#delErr").textContent="";$("#delSubmit").disabled=true;
  try{
    await api("/auth/me",{method:"DELETE",body:{password:$("#dPass").value}});
    setSession(null,null);$("#ordDlg").close();$("#delForm").reset();toast("Compte supprimé");
  }catch(err){$("#delErr").textContent=err.message}
  finally{$("#delSubmit").disabled=false}
};

// ---------- Divers ----------
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)}
const toggle=o=>document.body.classList.toggle("open",o);
$("#openCart").onclick=()=>toggle(true);
$("#closeCart").onclick=()=>toggle(false);
$("#overlay").onclick=()=>toggle(false);
$("#search").oninput=renderGrid;
$("#sort").onchange=renderGrid;
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("click",e=>{if(e.target===d)d.close()}));
document.addEventListener("keydown",e=>{if(e.key==="Escape")toggle(false)});
init();
