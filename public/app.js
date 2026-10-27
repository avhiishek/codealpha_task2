let currentUser=null;
let authMode="login";
let toastTimer;
const feed=document.querySelector("#feed");
const peoplePanel=document.querySelector("#peoplePanel");
const profilePanel=document.querySelector("#profilePanel");
async function api(url,options={}){
  const response=await fetch(url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Something went wrong.");
  return data;
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
function avatar(name){return `<div class="avatar">${escapeHtml(String(name||"?").trim().charAt(0).toUpperCase())}</div>`;}
function toast(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2500);}
function timeAgo(value){
  const date=new Date(value.endsWith("Z")?value:value.replace(" ","T")+"Z");
  if(Number.isNaN(date.getTime()))return "recently";
  const mins=Math.floor((Date.now()-date.getTime())/60000);
  if(mins<1)return "just now";if(mins<60)return `${mins}m ago`;
  if(mins<1440)return `${Math.floor(mins/60)}h ago`;
  return `${Math.floor(mins/1440)}d ago`;
}
async function loadFeed(){
  try{
    const posts=await api("/api/feed");
    document.querySelector("#feedCount").textContent=`${posts.length} posts`;
    feed.innerHTML=posts.length?posts.map(post=>`
      <article class="post-card" data-post="${post.id}">
        <div class="post-header">${avatar(post.name)}<div><div class="post-author">${escapeHtml(post.name)}</div><div class="post-time">${timeAgo(post.created_at)}</div></div></div>
        <div class="post-body">${escapeHtml(post.content)}</div>
        <div class="post-actions">
          <button class="action-button ${post.liked?"liked":""}" data-action="like" data-id="${post.id}">${post.liked?"♥":"♡"} ${post.likes} likes</button>
          <button class="action-button" data-action="comments" data-id="${post.id}">☰ ${post.comment_count} comments</button>
          ${currentUser&&currentUser.id!==post.user_id?`<button class="follow-button" data-action="follow" data-id="${post.user_id}">${post.following?"Following":"＋ Follow"}</button>`:""}
        </div><div class="comments" hidden><div class="comments-list"></div>
          <form class="comment-form" data-id="${post.id}"><input name="content" maxlength="300" placeholder="Write a comment…" required><button type="submit">Send</button></form>
        </div>
      </article>`).join(""):'<div class="empty-state">No posts yet. Share the first thought with the community.</div>';
  }catch{feed.innerHTML='<div class="empty-state">Could not load the feed. Refresh the page to try again.</div>';}
}
feed.addEventListener("click",async event=>{
  const button=event.target.closest("[data-action]");
  if(!button)return;
  const action=button.dataset.action,id=button.dataset.id;
  if(action==="comments"){
    const section=button.closest(".post-card").querySelector(".comments");
    section.hidden=!section.hidden;
    if(!section.hidden)await loadComments(id,section);
  }
  if(action==="like"){
    if(!currentUser)return openAuth("login");
    try{await api(`/api/posts/${id}/like`,{method:"POST",body:"{}"});await loadFeed();}
    catch(err){toast(err.message);}
  }
  if(action==="follow"){
    try{await api(`/api/users/${id}/follow`,{method:"POST",body:"{}"});await loadFeed();toast("Following list updated.");}
    catch(err){toast(err.message);}
  }
});
async function loadComments(id,section){
  try{
    const comments=await api(`/api/posts/${id}/comments`);
    section.querySelector(".comments-list").innerHTML=comments.length?comments.map(c=>`<div class="comment"><strong>${escapeHtml(c.name)}</strong>${escapeHtml(c.content)}</div>`).join(""):'<div class="comment">No comments yet. Start the conversation.</div>';
  }catch(err){toast(err.message);}
}
feed.addEventListener("submit",async event=>{
  if(!event.target.matches(".comment-form"))return;
  event.preventDefault();
  if(!currentUser)return openAuth("login");
  const form=event.target,id=form.dataset.id,content=new FormData(form).get("content");
  try{await api(`/api/posts/${id}/comments`,{method:"POST",body:JSON.stringify({content})});form.reset();await loadFeed();const card=feed.querySelector(`[data-post="${id}"]`);const section=card.querySelector(".comments");section.hidden=false;await loadComments(id,section);}
  catch(err){toast(err.message);}
});
document.querySelector("#postContent").addEventListener("input",event=>document.querySelector("#charCount").textContent=`${event.target.value.length} / 500`);
document.querySelector("#postForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!currentUser)return openAuth("login");
  const content=document.querySelector("#postContent").value;
  try{await api("/api/posts",{method:"POST",body:JSON.stringify({content})});event.target.reset();document.querySelector("#charCount").textContent="0 / 500";document.querySelector("#postError").textContent="";hidePanels();await loadFeed();toast("Your post is live.");}
  catch(err){document.querySelector("#postError").textContent=err.message;}
});
function openAuth(mode){
  authMode=mode;
  document.querySelector("#authTitle").textContent=mode==="login"?"Good to see you.":"Make yourself at home.";
  document.querySelector("#authSubmit").textContent=mode==="login"?"Log in":"Create account";
  document.querySelector("#nameLabel").hidden=mode==="login";
  document.querySelector("#nameLabel input").required=mode==="register";
  document.querySelector("#switchText").textContent=mode==="login"?"New to Gather?":"Already a member?";
  document.querySelector("#switchAuth").textContent=mode==="login"?"Create an account":"Log in";
  document.querySelector("#authError").textContent="";
  document.querySelector("#authForm").reset();
  document.querySelector("#authDialog").showModal();
}
document.querySelector("#authButton").addEventListener("click",()=>currentUser?logout():openAuth("login"));
document.querySelector("#closeAuth").addEventListener("click",()=>document.querySelector("#authDialog").close());
document.querySelector("#switchAuth").addEventListener("click",()=>openAuth(authMode==="login"?"register":"login"));
document.querySelector("#authForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const payload=Object.fromEntries(new FormData(event.currentTarget).entries());
  try{
    const result=await api(`/api/${authMode}`,{method:"POST",body:JSON.stringify(payload)});
    currentUser=result.user;document.querySelector("#authDialog").close();updateAccount();await loadFeed();toast(authMode==="login"?"Welcome back.":"Welcome to Gather.");
  }catch(err){document.querySelector("#authError").textContent=err.message;}
});
async function logout(){
  await api("/api/logout",{method:"POST",body:"{}"});
  currentUser=null;updateAccount();hidePanels();await loadFeed();toast("You have logged out.");
}
function updateAccount(){
  document.querySelector("#userLabel").textContent=currentUser?`Hi, ${currentUser.name}`:"Welcome";
  document.querySelector("#authButton").textContent=currentUser?"Log out":"Log in";
}
function hidePanels(){peoplePanel.hidden=true;profilePanel.hidden=true;document.querySelector("#composer").hidden=false;document.querySelector("#feedTitle").textContent="Community feed";}
document.querySelector("#feedButton").addEventListener("click",()=>{hidePanels();window.scrollTo({top:0,behavior:"smooth"});});
document.querySelector("#peopleButton").addEventListener("click",showPeople);
document.querySelector("#discoverSideButton").addEventListener("click",showPeople);
document.querySelector("#closePeople").addEventListener("click",()=>peoplePanel.hidden=true);
async function showPeople(){
  hidePanels();peoplePanel.hidden=false;
  try{
    const people=await api("/api/users");
    document.querySelector("#peopleList").innerHTML=people.filter(p=>!currentUser||p.id!==currentUser.id).map(p=>`
      <div class="person-row">${avatar(p.name)}<div class="person-meta"><strong>${escapeHtml(p.name)}</strong><p>${escapeHtml(p.bio||"Finding their community.")}</p><p>${p.followers} followers</p></div>
      <button class="primary-button" data-person="${p.id}">View profile</button></div>`).join("")||'<p class="profile-bio">You are the first one here.</p>';
  }catch(err){toast(err.message);}
}
document.querySelector("#peopleList").addEventListener("click",event=>{
  const button=event.target.closest("[data-person]");
  if(button)showProfile(button.dataset.person);
});
document.querySelector("#myProfileButton").addEventListener("click",()=>{
  if(!currentUser)return openAuth("login");
  showProfile(currentUser.id);
});
async function showProfile(id){
  hidePanels();profilePanel.hidden=false;profilePanel.innerHTML="<p>Loading profile…</p>";
  try{
    const p=await api(`/api/profile/${id}`);
    profilePanel.innerHTML=`
      <div class="profile-cover">${avatar(p.name)}<div><p class="overline">COMMUNITY MEMBER</p><h2>${escapeHtml(p.name)}</h2></div></div>
      <p class="profile-bio">${escapeHtml(p.bio||"No bio yet.")}</p>
      <div class="profile-stats"><span><strong>${p.posts}</strong>posts</span><span><strong>${p.followers}</strong>followers</span><span><strong>${p.following}</strong>following</span></div>
      ${p.isMe?`<form id="profileEdit" class="profile-edit"><label>Display name<input name="name" maxlength="60" value="${escapeHtml(p.name)}" required></label><label>Bio<input name="bio" maxlength="160" value="${escapeHtml(p.bio||"")}" placeholder="A little about you"></label><p id="profileError" class="error"></p><button class="primary-button" type="submit">Save profile</button></form>`:
      currentUser?`<button class="primary-button" id="profileFollow">${p.isFollowing?"Unfollow":"Follow"} ${escapeHtml(p.name)}</button>`:'<p class="profile-bio">Log in to follow people and join the conversation.</p>'}`;
    const follow=document.querySelector("#profileFollow");
    if(follow)follow.addEventListener("click",async()=>{try{await api(`/api/users/${p.id}/follow`,{method:"POST",body:"{}"});await showProfile(id);await loadFeed();}catch(err){toast(err.message);}});
    const edit=document.querySelector("#profileEdit");
    if(edit)edit.addEventListener("submit",async event=>{event.preventDefault();const payload=Object.fromEntries(new FormData(edit).entries());try{const result=await api("/api/profile",{method:"PUT",body:JSON.stringify(payload)});currentUser=result.user;updateAccount();await showProfile(id);toast("Profile updated.");}catch(err){document.querySelector("#profileError").textContent=err.message;}});
  }catch(err){profilePanel.innerHTML=`<p class="error">${escapeHtml(err.message)}</p>`;}
}
(async function start(){
  try{currentUser=(await api("/api/me")).user;}catch{}
  updateAccount();await loadFeed();
})();
