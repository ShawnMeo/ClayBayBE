#!/usr/bin/env node
/* Regenerates models/thumbs/*.png for gallery mode by screenshotting each
   model in the live viewer. Requires the site running (node server.js) and
   playwright-core installed. Usage:  node build-thumbs.js  */
const { chromium } = require('playwright-core');
const fs=require('fs'), path=require('path');
const SITE=__dirname;
(async () => {
  const models = JSON.parse(fs.readFileSync(path.join(SITE,'models/manifest.json'),'utf8')).models;
  const b = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport:{width:640,height:640}, deviceScaleFactor:2 })).newPage();
  await p.goto('http://localhost:8777/', { waitUntil:'networkidle' });
  await p.waitForTimeout(6000);
  await p.addStyleTag({ content:'.col,header,.stagebar,.quote{display:none!important} #stage::before{display:none!important}' });
  for (let i=0;i<models.length;i++){
    await p.$$eval('#shelf .spec-btn', (els,i)=>els[i].click(), i);
    await p.waitForTimeout(8500);
    await p.evaluate(()=>{ const b=document.getElementById('play'); if(b.getAttribute('aria-pressed')==='true') b.click(); });
    await p.waitForTimeout(900);
    // No zoom: the viewer already frames each piece to a uniform size.
    // Square crop around the model's resting area, generous margins.
    const out = path.join(SITE,'models/thumbs', models[i].file.replace(/\.(glb|gltf)$/i,'') + '.png');
    await p.screenshot({ path: out, clip:{ x:150, y:60, width:340, height:340 } });
    console.log('thumb:', path.basename(out));
  }
  await b.close();
})();
