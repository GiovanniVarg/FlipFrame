import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/giovanni.vargas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root=path.resolve('dist');
const server=http.createServer((req,res)=>{const file=path.join(root,req.url.startsWith('/assets/')?req.url:'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/giovanni.vargas/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});
try{
 const page=await browser.newPage();const settings={values:{SAM2_DEVICE:'auto',REASONING_PROVIDER:'jev',VIDEO_PROVIDER:'higgsfield',LLM_BASE_URL:'',LLM_MODEL:''},configured:{LLM_API_KEY:true,TYPESAFE_API_KEY:true,HF_CREDENTIALS:true}};const writes=[];
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());let body={};if(url.pathname==='/api/config')body={mode:'local',authRequired:false};else if(url.pathname==='/api/auth/session')body={user:null};else if(url.pathname==='/api/projects')body=[];else if(url.pathname==='/api/capabilities')body={reasons:{}};else if(url.pathname==='/api/settings'){if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());Object.assign(settings.values,route.request().postDataJSON())}body=settings;}else if(url.pathname==='/api/settings/hardware')body={cpu:{name:'Test CPU',logicalCores:8},cudaAvailable:true,gpus:[{name:'Test GPU',memoryBytes:4294967296}]};else if(url.pathname==='/api/settings/agent'){if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());body={enabled:true,baseUrl:'http://localhost',token:'fake-test-token'}}else body={enabled:false,baseUrl:'http://localhost'};}await route.fulfill({json:body});});
 await page.goto(`http://127.0.0.1:${server.address().port}/studio`);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByText('Test GPU · 4.0 GB memory').waitFor();
 await page.getByLabel('Run object selection on').selectOption('cuda');await page.getByRole('button',{name:'Save processing choice'}).click();await page.getByRole('status').waitFor();assert.equal(writes.at(-1).SAM2_DEVICE,'cuda');
 await page.getByRole('button',{name:'Assistant',exact:true}).click();assert.equal(await page.getByLabel('Replace API key (optional)').inputValue(),'');await page.getByRole('button',{name:'Save assistant',exact:true}).click();await page.getByRole('status').waitFor();assert.equal('TYPESAFE_API_KEY' in writes.at(-1),false);
 await page.getByRole('button',{name:'Video',exact:true}).click();await page.getByRole('button',{name:'Save video connection'}).click();await page.getByRole('status').waitFor();assert.equal('HF_CREDENTIALS' in writes.at(-1),false);
 await page.getByRole('button',{name:'Agent access',exact:true}).click();await page.getByRole('button',{name:'Create access key'}).waitFor();assert.equal(await page.getByLabel('New agent access key').count(),0);await page.getByRole('button',{name:'Create access key'}).click();await page.getByLabel('New agent access key').waitFor();assert.equal(await page.getByLabel('New agent access key').inputValue(),'fake-test-token');await page.getByRole('button',{name:'Processing',exact:true}).click();assert.equal(await page.getByLabel('New agent access key').count(),0);await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 console.log('PASS: settings tabs, GPU selection, blank keys preserved, agent controls, Escape. No real API or credential access.');
}finally{await browser.close();server.close();}
