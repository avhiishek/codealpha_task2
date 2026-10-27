const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3002;
const db = new sqlite3.Database(path.join(__dirname, "social.db"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-local-demo-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(express.static(path.join(__dirname, "public")));

const run = (sql, params = []) => new Promise((resolve, reject) =>
  db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) =>
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) =>
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));

async function init() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  await run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  await run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  await run(`CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER NOT NULL, post_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, post_id))`);
  await run(`CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL, following_id INTEGER NOT NULL,
    PRIMARY KEY (follower_id, following_id), CHECK (follower_id <> following_id))`);
  const count = await get("SELECT COUNT(*) AS n FROM posts");
  if (!count.n) {
    const demoHash = await bcrypt.hash("demo123", 10);
    const users = [
      ["Maya Chen","maya@example.com",demoHash,"Design student. Collecting ideas and good coffee."],
      ["Arjun Mehta","arjun@example.com",demoHash,"Building small things and learning every day."],
      ["Sara Khan","sara@example.com",demoHash,"Photography, books and weekend walks."]
    ];
    for (const u of users) await run("INSERT OR IGNORE INTO users (name,email,password,bio) VALUES (?,?,?,?)",u);
    const demoUsers = await all("SELECT id,name FROM users ORDER BY id");
    const demoPosts = [
      [demoUsers[0].id,"Spent the afternoon redesigning my portfolio. Keeping it simple made a bigger difference than adding more features."],
      [demoUsers[1].id,"Today's goal: learn one new thing, write a little code, and take a proper break."],
      [demoUsers[2].id,"Found a quiet corner of the city with the best evening light. Sometimes the small plans are the best ones."]
    ];
    for (const post of demoPosts) await run("INSERT INTO posts (user_id,content) VALUES (?,?)",post);
  }
}
function requireLogin(req,res,next) {
  if (!req.session.user) return res.status(401).json({error:"Please log in first."});
  next();
}
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));
app.post("/api/register",async(req,res)=>{
  const name=String(req.body.name||"").trim();
  const email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  if(!name||!email.includes("@")||password.length<6)
    return res.status(400).json({error:"Enter a name, valid email and password with at least 6 characters."});
  try{
    const hash=await bcrypt.hash(password,10);
    const result=await run("INSERT INTO users (name,email,password) VALUES (?,?,?)",[name,email,hash]);
    req.session.user={id:result.lastID,name,email,bio:""};
    res.json({user:req.session.user});
  }catch(err){
    res.status(err.code==="SQLITE_CONSTRAINT"?409:500).json({error:err.code==="SQLITE_CONSTRAINT"?"This email is already registered.":"Could not create account."});
  }
});
app.post("/api/login",async(req,res)=>{
  const email=String(req.body.email||"").trim().toLowerCase();
  try{
    const user=await get("SELECT * FROM users WHERE email=?",[email]);
    if(!user||!(await bcrypt.compare(String(req.body.password||""),user.password)))
      return res.status(401).json({error:"Email or password is incorrect."});
    req.session.user={id:user.id,name:user.name,email:user.email,bio:user.bio};
    res.json({user:req.session.user});
  }catch{res.status(500).json({error:"Could not log in."});}
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/feed",async(req,res)=>{
  try{
    const posts=await all(`SELECT p.id,p.content,p.created_at,u.id AS user_id,u.name,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comment_count,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked,
      EXISTS(SELECT 1 FROM follows f WHERE f.following_id=p.user_id AND f.follower_id=?) AS following
      FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC`,[req.session.user?.id||0,req.session.user?.id||0]);
    res.json(posts);
  }catch{res.status(500).json({error:"Could not load feed."});}
});
app.post("/api/posts",requireLogin,async(req,res)=>{
  const content=String(req.body.content||"").trim();
  if(!content||content.length>500)return res.status(400).json({error:"Write a post between 1 and 500 characters."});
  try{const result=await run("INSERT INTO posts (user_id,content) VALUES (?,?)",[req.session.user.id,content]);res.json({id:result.lastID});}
  catch{res.status(500).json({error:"Could not publish post."});}
});
app.post("/api/posts/:id/like",requireLogin,async(req,res)=>{
  const postId=Number(req.params.id);
  try{
    const existing=await get("SELECT 1 FROM likes WHERE user_id=? AND post_id=?",[req.session.user.id,postId]);
    if(existing)await run("DELETE FROM likes WHERE user_id=? AND post_id=?",[req.session.user.id,postId]);
    else await run("INSERT OR IGNORE INTO likes (user_id,post_id) VALUES (?,?)",[req.session.user.id,postId]);
    const count=await get("SELECT COUNT(*) AS n FROM likes WHERE post_id=?",[postId]);
    res.json({liked:!existing,likes:count.n});
  }catch{res.status(500).json({error:"Could not update like."});}
});
app.get("/api/posts/:id/comments",async(req,res)=>{
  try{res.json(await all(`SELECT c.id,c.content,c.created_at,u.name,u.id AS user_id
    FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.id`,[req.params.id]));}
  catch{res.status(500).json({error:"Could not load comments."});}
});
app.post("/api/posts/:id/comments",requireLogin,async(req,res)=>{
  const content=String(req.body.content||"").trim();
  if(!content||content.length>300)return res.status(400).json({error:"Write a comment between 1 and 300 characters."});
  try{
    const post=await get("SELECT id FROM posts WHERE id=?",[req.params.id]);
    if(!post)return res.status(404).json({error:"Post not found."});
    await run("INSERT INTO comments (post_id,user_id,content) VALUES (?,?,?)",[post.id,req.session.user.id,content]);
    res.json({ok:true});
  }catch{res.status(500).json({error:"Could not add comment."});}
});
app.post("/api/users/:id/follow",requireLogin,async(req,res)=>{
  const target=Number(req.params.id), me=req.session.user.id;
  if(target===me)return res.status(400).json({error:"You cannot follow your own profile."});
  try{
    const user=await get("SELECT id FROM users WHERE id=?",[target]);
    if(!user)return res.status(404).json({error:"User not found."});
    const existing=await get("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?",[me,target]);
    if(existing)await run("DELETE FROM follows WHERE follower_id=? AND following_id=?",[me,target]);
    else await run("INSERT OR IGNORE INTO follows (follower_id,following_id) VALUES (?,?)",[me,target]);
    const count=await get("SELECT COUNT(*) AS n FROM follows WHERE following_id=?",[target]);
    res.json({following:!existing,followers:count.n});
  }catch{res.status(500).json({error:"Could not update follow."});}
});
app.get("/api/profile/:id",async(req,res)=>{
  try{
    const user=await get(`SELECT id,name,bio,created_at,
      (SELECT COUNT(*) FROM posts WHERE user_id=users.id) AS posts,
      (SELECT COUNT(*) FROM follows WHERE following_id=users.id) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id=users.id) AS following
      FROM users WHERE id=?`,[req.params.id]);
    if(!user)return res.status(404).json({error:"Profile not found."});
    user.isFollowing=!!(req.session.user && await get("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?",[req.session.user.id,user.id]));
    user.isMe=!!(req.session.user && req.session.user.id===user.id);
    res.json(user);
  }catch{res.status(500).json({error:"Could not load profile."});}
});
app.put("/api/profile",requireLogin,async(req,res)=>{
  const name=String(req.body.name||"").trim();
  const bio=String(req.body.bio||"").trim().slice(0,160);
  if(!name)return res.status(400).json({error:"Name cannot be empty."});
  try{
    await run("UPDATE users SET name=?,bio=? WHERE id=?",[name,bio,req.session.user.id]);
    req.session.user.name=name;req.session.user.bio=bio;
    res.json({user:req.session.user});
  }catch{res.status(500).json({error:"Could not update profile."});}
});
app.get("/api/users",async(req,res)=>{
  try{res.json(await all(`SELECT id,name,bio,
    (SELECT COUNT(*) FROM follows WHERE following_id=users.id) AS followers
    FROM users ORDER BY name LIMIT 30`));}
  catch{res.status(500).json({error:"Could not load people."});}
});

init().then(()=>app.listen(PORT,()=>console.log(`Social Media app running at http://localhost:${PORT}`)))
  .catch(err=>{console.error(err);process.exit(1);});
