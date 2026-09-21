import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scrypt as rawScrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
const scrypt=promisify(rawScrypt);
const SESSION_AGE=7*24*60*60*1000;
const digest=value=>createHash('sha256').update(value).digest('hex');
const credentials=body=>{const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';const password=body?.password;if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof password!=='string'||password.length<12||password.length>256)return null;return {email,password};};
export async function hashPassword(password){const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return `${salt}:${hash.toString('hex')}`;}
export async function verifyPassword(password,stored){try{const [salt,encoded]=stored.split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(encoded))return false;const actual=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return timingSafeEqual(actual,Buffer.from(encoded,'hex'));}catch{return false;}}
export function createAuth({dataDir,secureCookies=false,origin,mode=process.env.LAB_MODE||'local',inviteCode=process.env.LAB_INVITE_CODE,now=Date.now,loginLimit=10}={}){
 if(!dataDir)throw new Error('Authentication requires a persistent dataDir.');
 if(mode==='saas'&&!origin)throw new Error('APP_ORIGIN is required in SaaS mode.');
 if(origin){const parsed=new URL(origin);if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)throw new Error('APP_ORIGIN must be an exact HTTP(S) origin without a trailing slash.');if(mode==='saas'&&parsed.protocol!=='https:')throw new Error('SaaS APP_ORIGIN must use HTTPS.');}
 if(mode==='saas'&&!secureCookies)throw new Error('SaaS mode requires secure session cookies.');
 fs.mkdirSync(dataDir,{recursive:true});const db=new DatabaseSync(path.join(dataDir,'auth.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at); CREATE TABLE IF NOT EXISTS auth_attempts (bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL);');
 const findUser=db.prepare('SELECT id,email,password_hash FROM users WHERE email=?');
 const findSession=db.prepare('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?');
 const cookieName=secureCookies?'__Host-lab_session':'lab_session';
 const cookie=(res,token,maxAge)=>res.cookie(cookieName,token,{httpOnly:true,secure:secureCookies,sameSite:'lax',path:'/',maxAge});
 const tokenFrom=req=>{const parts=(req.headers.cookie||'').split(';').map(v=>v.trim());const values=parts.filter(v=>v.startsWith(cookieName+'='));if(values.length!==1)return null;const token=values[0].slice(cookieName.length+1);return /^[a-f0-9]{64}$/.test(token)?token:null;};
 const resolve=req=>{const token=tokenFrom(req);return token?findSession.get(digest(token),now())||null:null;};
 function requireUser(req,res,next){const user=resolve(req);if(!user)return res.status(401).json({error:'Sign in to access this workspace.'});req.user=user;next();}
 function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const supplied=req.get('origin');let expected=origin;if(!expected){const host=req.get('host');if(!host||! /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))return res.status(403).json({error:'Configure APP_ORIGIN for this host.'});expected=`${req.protocol}://${host}`;}if(supplied!==expected)return res.status(403).json({error:'Request origin is not allowed. Reload the app and retry.'});next();}
 function rateLimit(req,res,next){const timestamp=now();db.prepare('DELETE FROM auth_attempts WHERE reset_at<=?').run(timestamp);const bucket=digest(req.ip||req.socket.remoteAddress||'unknown');const old=db.prepare('SELECT attempts,reset_at FROM auth_attempts WHERE bucket=?').get(bucket);if(old&&old.attempts>=loginLimit){res.set('Retry-After',String(Math.ceil((old.reset_at-timestamp)/1000)));return res.status(429).json({error:'Too many authentication attempts. Try again in 15 minutes.'});}db.prepare('INSERT INTO auth_attempts(bucket,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1').run(bucket,timestamp+15*60*1000);next();}
 function issueSession(req,res,user){const old=tokenFrom(req);if(old)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(old));const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now());db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),user.id,now()+SESSION_AGE);cookie(res,token,SESSION_AGE);return {id:user.id,email:user.email};}
 const router=express.Router();router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});router.use(csrf);
 router.get('/session',(req,res)=>res.json({user:resolve(req)}));
 router.post('/signup',rateLimit,async(req,res,next)=>{try{const input=credentials(req.body);if(!input)return res.status(400).json({error:'Enter a valid email and a password between 12 and 256 characters.'});if(inviteCode){const given=typeof req.body.inviteCode==='string'?req.body.inviteCode:'';if(!timingSafeEqual(Buffer.from(digest(given)),Buffer.from(digest(inviteCode))))return res.status(403).json({error:'A valid invitation code is required.'});}const passwordHash=await hashPassword(input.password);const user={id:randomUUID(),email:input.email};try{db.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(user.id,user.email,passwordHash,now());}catch(e){if(e.code==='ERR_SQLITE_ERROR'&&String(e.message).includes('UNIQUE'))return res.status(409).json({error:'An account could not be created with these details. Try signing in.'});throw e;}res.status(201).json({user:issueSession(req,res,user)});}catch(e){next(e);}});
 const dummy='0'.repeat(32)+':'+ '0'.repeat(128);
 router.post('/login',rateLimit,async(req,res,next)=>{try{const input=credentials(req.body);if(!input)return res.status(401).json({error:'Email or password is incorrect.'});const user=findUser.get(input.email);const valid=await verifyPassword(input.password,user?.password_hash||dummy);if(!user||!valid)return res.status(401).json({error:'Email or password is incorrect.'});res.json({user:issueSession(req,res,user)});}catch(e){next(e);}});
 router.post('/logout',(req,res)=>{const token=tokenFrom(req);if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));cookie(res,'',0);res.json({ok:true});});
 return {router,requireUser,csrf,close:()=>db.close()};
}
