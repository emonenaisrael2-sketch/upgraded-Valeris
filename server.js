const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'valerisbank';
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable.');
  process.exit(1);
}
const mongoClient = new MongoClient(MONGODB_URI);
let users;
const sessions = new Map();
const codes = new Map();


app.use(express.json({ limit: '1mb' }));


function norm(v) { return String(v || '').trim().toLowerCase(); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}
function verifyPassword(password, hash, salt) {
  try {
    const a = Buffer.from(crypto.scryptSync(String(password), salt, 64).toString('hex'), 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
function publicUser(u) {
  return { id:u.id, accountNumber:u.accountNumber, firstName:u.firstName, lastName:u.lastName, email:u.email, country:u.country, phone:u.phone, createdAt:u.createdAt };
}
function defaultData() {
  return {
    mainBalance: 50,
    taskBalance: 0,
    investmentBalance: 0,
    taskEarnings: 0,
    investmentProfit: 0,
    completedTasks: 0,
    dailyTaskCompletions: {},
    investments: [],
    activity: []
  };
}
function stamp() {
  return new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function activity(title, amount, status='Completed', description='') {
  return { id: crypto.randomUUID(), title, amount:Number(amount)||0, status, description, date:stamp() };
}
async function auth(req,res,next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const userId = sessions.get(token);
    if (!userId) return res.status(401).json({ message:'Your session has expired. Please log in again.' });
    const user = await users.findOne({ id:userId });
    if (!user) return res.status(401).json({ message:'Account not found.' });
    req.token = token; req.userId = userId; req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ message:'Database error. Please try again.' });
  }
}
async function save(req) {
  await users.updateOne({ id:req.userId }, { $set: { data:req.user.data } });
}


function settleMaturedInvestments(data) {
  data.investments ??= [];
  let changed = false;
  for (const inv of data.investments) {
    if (inv.status === 'active' && Date.now() >= new Date(inv.maturesAt).getTime()) {
      inv.status = 'completed';
      inv.completedAt = new Date().toISOString();
      data.investmentBalance = Math.max(0, Number(data.investmentBalance || 0) - Number(inv.amount || 0));
      data.mainBalance += Number(inv.amount || 0) + Number(inv.profit || 0);
      data.investmentProfit += Number(inv.profit || 0);
      data.activity.push(activity('Demo Investment Matured', Number(inv.amount || 0) + Number(inv.profit || 0), 'Completed', 'Capital and 30% demo profit returned after the 24-hour simulation period.'));
      changed = true;
    }
  }
  return changed;
}

const TASKS = {
  dailyCheckIn: { title:'Daily Check-in', reward:50 },
  financialKnowledgeQuiz: { title:'Financial Knowledge Quiz', reward:100 },
  investmentArticle: { title:'Read an Investment Article', reward:75 },
  cryptoMemoryPuzzle: { title:'Crypto Memory Puzzle', reward:80 },
  bitcoinJigsawPuzzle: { title:'Bitcoin Jigsaw Puzzle', reward:90 },
  investmentEducation: { title:'Investment Education', reward:120 },
  completeSurvey: { title:'Complete Survey', reward:60 },
  marketWatch: { title:'Market Watch', reward:70 },
  budgetPlanner: { title:'Budget Planner', reward:85 },
  securityCheck: { title:'Security Check', reward:65 }
};

function validateTask(id, body) {
  const b = body || {};
  switch (id) {
    case 'dailyCheckIn': return b.confirm === true;
    case 'financialKnowledgeQuiz': return b.q1==='budget' && b.q2==='diversification' && b.q3==='risk';
    case 'investmentArticle': return b.read === true && String(b.takeaway || '').trim().length >= 10;
    case 'cryptoMemoryPuzzle': return Array.isArray(b.pairs) && b.pairs.length === 4 && new Set(b.pairs).size === 4;
    case 'bitcoinJigsawPuzzle': return String(b.answer || '').trim().toLowerCase() === 'blockchain';
    case 'investmentEducation': return b.lesson === 'compound' && b.confirm === true;
    case 'completeSurvey': return ['excellent','good','average','poor'].includes(b.rating) && String(b.feedback || '').trim().length >= 8;
    case 'marketWatch': return b.direction === 'up' || b.direction === 'down' || b.direction === 'flat';
    case 'budgetPlanner': {
      const income = Number(b.income), needs = Number(b.needs), savings = Number(b.savings);
      return Number.isFinite(income) && income > 0 && Number.isFinite(needs) && needs >= 0 && Number.isFinite(savings) && savings >= 0 && needs + savings <= income;
    }
    case 'securityCheck': return b.password === true && b.phishing === true && b.twoFactor === true;
    default: return false;
  }
}

app.post('/api/signup', async (req,res) => {
  try {
    const { firstName,lastName,email,country,phone,password } = req.body || {};
    if (!firstName || !lastName || !email || !country || !phone || !password) return res.status(400).json({ message:'Please complete all required fields.' });
    if (String(password).length < 8) return res.status(400).json({ message:'Password must be at least 8 characters.' });
    const e = norm(email); const p = norm(phone);
    const duplicate = await users.findOne({ $or:[{ email:e },{ phone:p }] });
    if (duplicate) return res.status(409).json({ message:'An account with that email or phone already exists.' });
    const id = crypto.randomUUID(); const hp = hashPassword(password);
    const user = { id, accountNumber:'VL'+String(Date.now()).slice(-8)+crypto.randomInt(10,100), firstName:String(firstName).trim(), lastName:String(lastName).trim(), email:e, country:String(country).trim(), phone:String(phone).trim(), passwordHash:hp.hash, passwordSalt:hp.salt, createdAt:new Date().toISOString(), data:defaultData() };
    user.data.activity.push(activity('Welcome Bouns',50,'Completed','Your individual demo dashboard is ready.'));
    await users.insertOne(user);
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token,id);
    res.status(201).json({ token, user:publicUser(user) });
  } catch (error) {
    console.error('Signup error:', error);
    if (error && error.code === 11000) return res.status(409).json({ message:'An account with that email or phone already exists.' });
    res.status(500).json({ message:'Could not create account. Please try again.' });
  }
});

app.post('/api/login', async (req,res) => {
  try {
    const { identity,password } = req.body || {};
    const value = norm(identity);
    const user = await users.findOne({ $or:[{ email:value },{ phone:value }] });
    if (!user || !verifyPassword(password,user.passwordHash,user.passwordSalt)) return res.status(401).json({ message:'Incorrect email/phone or password.' });
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token,user.id);
    res.json({ token, user:publicUser(user) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message:'Could not log in. Please try again.' });
  }
});

app.get('/api/me', auth, (req,res) => res.json({ user:publicUser(req.user) }));
app.get('/api/me/data', auth, async (req,res) => {
  req.user.data ??= defaultData();
  if (settleMaturedInvestments(req.user.data)) await save(req);
  res.json({ data:req.user.data });
});
app.post('/api/logout', auth, (req,res) => { sessions.delete(req.token); res.json({ ok:true }); });

app.post('/api/test/verification-code', auth, (req,res) => {
  const code = crypto.randomInt(100000,1000000).toString();
  codes.set(req.userId,{ code, expires:Date.now()+300000 });
  console.log(`[VALERIS DEMO OTP] user=${req.userId} code=${code} expires=5m`);
  res.json({ ok:true, message:'Demo code generated. Check the server/Render logs.' });
});
function checkCode(userId, code) {
  const record = codes.get(userId);
  if (!record || Date.now()>record.expires || String(code)!==record.code) { if (record && Date.now()>record.expires) codes.delete(userId); return false; }
  codes.delete(userId); return true;
}
app.post('/api/test/fund', auth, async (req,res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount<=0) return res.status(400).json({ message:'Enter a valid funding amount.' });
  if (!checkCode(req.userId,req.body?.code)) return res.status(400).json({ message:'Invalid or expired verification code.' });
  req.user.data ??= defaultData(); req.user.data.mainBalance += amount;
  req.user.data.activity.push(activity('Demo Wallet Funding',amount,'Completed','Test funding only.'));
  await save(req); res.json({ ok:true, message:`Demo funding verified. £${amount.toFixed(2)} added.` });
});

app.get('/api/test/tasks', auth, (req,res) => res.json({ tasks:TASKS }));
app.post('/api/test/tasks/:id/submit', auth, async (req,res) => {
  const id = req.params.id; const task = TASKS[id];
  if (!task) return res.status(404).json({ message:'Task not found.' });
  req.user.data ??= defaultData(); const d = req.user.data;
  d.dailyTaskCompletions ??= {};
  if (d.dailyTaskCompletions[id]) return res.status(400).json({ message:'This task has already been rewarded.' });
  if (!validateTask(id,req.body)) return res.status(400).json({ message:'Please complete the activity correctly before claiming the reward.' });
  d.dailyTaskCompletions[id] = new Date().toISOString();
  d.taskBalance += task.reward; d.taskEarnings += task.reward; d.completedTasks += 1;
  d.activity.push(activity('Task Reward: '+task.title,task.reward,'Completed','Participative demo task completed.'));
  await save(req); res.json({ ok:true, message:`Task completed. £${task.reward.toFixed(2)} demo reward added.` });
});

app.post('/api/test/withdraw', auth, async (req,res) => {
  const amount = Number(req.body?.amount); req.user.data ??= defaultData(); settleMaturedInvestments(req.user.data);
  const d=req.user.data, total=d.mainBalance+d.taskBalance+d.investmentProfit;
  if (!Number.isFinite(amount)||amount<=0) return res.status(400).json({ message:'Enter a valid withdrawal amount.' });
  if (amount>total) return res.status(400).json({ message:'Withdrawal amount exceeds eligible demo balance.' });
  let remaining=amount;
  for (const key of ['mainBalance','taskBalance','investmentProfit']) { const take=Math.min(Number(d[key]||0),remaining); d[key]-=take; remaining-=take; if(remaining<=0) break; }
  d.activity.push(activity('Demo Withdrawal',-amount,'Completed','Your withdrawal has been processed.'));
  await save(req); res.json({ ok:true, message:'Your withdrawal has been processed.' });
});

app.post('/api/test/invest', auth, async (req,res) => {
  const amount = Number(req.body?.amount); req.user.data ??= defaultData(); const d=req.user.data;
  if (!Number.isFinite(amount)||amount<=0) return res.status(400).json({ message:'Enter a valid amount.' });
  if (amount>d.mainBalance) return res.status(400).json({ message:'Simulation amount exceeds demo wallet balance.' });
  const profit = Math.round(amount*0.30*100)/100;
  const startedAt = new Date().toISOString(); const maturesAt = new Date(Date.now()+24*60*60*1000).toISOString();
  const inv = { id:crypto.randomUUID(), amount, profit, startedAt, maturesAt, status:'active' };
  d.mainBalance -= amount; d.investmentBalance += amount; d.investments.push(inv);
  d.activity.push(activity('Demo Investment Started',-amount,'Active','30% demo return scheduled after 24 hours.'));
  await save(req);
  res.json({ ok:true, investment:inv, message:'Demo investment started. Capital plus a 30% simulated profit will mature after 24 hours.' });
});

app.use(express.static(__dirname));
app.use((req,res) => res.sendFile(path.join(__dirname,'index.html')));
async function start() {
  try {
    await mongoClient.connect();
    const db = mongoClient.db(MONGODB_DB);
    users = db.collection('users');
    await users.createIndex({ email:1 }, { unique:true });
    await users.createIndex({ phone:1 }, { unique:true });
    await users.createIndex({ id:1 }, { unique:true });
    console.log(`MongoDB connected: ${MONGODB_DB}`);
    app.listen(PORT, () => console.log(`ValerisBank demo running on ${PORT}`));
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    process.exit(1);
  }
}
start();
