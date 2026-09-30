// @vitest-environment node
import {beforeAll,afterAll,describe,it,expect} from 'vitest'
import {createServer,type ViteDevServer} from 'vite'
import {chromium,type Browser,type Page} from '@playwright/test'
import {readFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import type {SampleEntry} from './library'
let server:ViteDevServer,browser:Browser,page:Page
const errors:string[]=[]
beforeAll(async()=>{
 server=await createServer({cacheDir:'node_modules/.vite-phase2-browser',server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const address=server.httpServer!.address() as {port:number}
 const executablePath=resolve('.browsers/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')
 browser=await chromium.launch({headless:true,executablePath:existsSync(executablePath)?executablePath:undefined});page=await browser.newPage({viewport:{width:1440,height:900}})
 page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
 await page.goto(`http://127.0.0.1:${address.port}/`)
},30000)
afterAll(async()=>{await browser?.close();await server?.close()})
describe('Phase 2 actual browser graph, recordings and panel',()=>{
 it('bundles byte-identical redistributable recordings with root and recorded velocity coverage',()=>{
  const entries=JSON.parse(readFileSync('public/samples/manifest.json','utf8')) as SampleEntry[]
  for(const type of ['Grand','Upright','Electric']){const samples=entries.filter(e=>e.type===type);expect(new Set(samples.map(e=>e.rootNote)).size).toBeGreaterThan(10);expect(new Set(samples.map(e=>e.velocityLow)).size).toBeGreaterThanOrEqual(2)}
  for(const e of entries){const data=readFileSync(`public/${e.file}`);expect(data.subarray(0,4).toString()).toBe('fLaC');expect(createHash('sha256').update(data).digest('hex')).toBe(e.sha256);expect(e.license).toMatch(/CC0|CC-BY/)}
 })
 it('renders all six instruments, performance controls, owned release and master through the production graph',async()=>{
  const result=await page.evaluate(async()=>{
   // Imports run in Vite's browser realm, using native OfflineAudioContext and real AudioWorklet nodes.
   const importModule=new Function('url','return import(url)') as (url:string)=>Promise<Record<string,any>>
   const {LayerAudioBackend}=await importModule('/src/layer-audio.ts')
   const {SampleLibrary}=await importModule('/src/library.ts')
   const {newInstrument}=await importModule('/src/instrument.ts')
   const {PianoEngine}=await importModule('/src/audio.ts')
   const {MidiInput}=await importModule('/src/inputs.ts')
   const decoder=new OfflineAudioContext(2,16000,16000),library=new SampleLibrary();await library.load(decoder)
   if(library.status!=='ready')throw Error(JSON.stringify([...library.failures]))
   const rms=(pcm:Float32Array)=>Math.sqrt(pcm.reduce((s,v)=>s+v*v,0)/pcm.length)
   const renders:Record<string,{rms:number;tail:number;fingerprint:number[];nodes:number;contexts:number;voices:number}>={}
   const render=async(name:string,change:(state:ReturnType<typeof newInstrument>)=>void,velocity=.6,release=false,resonate=false,pedalMode:string|null=null)=>{
    const ctx=new OfflineAudioContext(2,16000,16000);let contexts=0
    const backend=new LayerAudioBackend(()=>{contexts++;return {state:'running',sampleRate:ctx.sampleRate,currentTime:0,destination:ctx.destination,audioWorklet:ctx.audioWorklet,resume:async()=>{},close:async()=>{},createGain:()=>ctx.createGain(),createDynamicsCompressor:()=>ctx.createDynamicsCompressor(),createBufferSource:()=>ctx.createBufferSource(),createBuffer:(...args:Parameters<typeof ctx.createBuffer>)=>ctx.createBuffer(...args),createBiquadFilter:()=>ctx.createBiquadFilter(),createStereoPanner:()=>ctx.createStereoPanner(),decodeAudioData:(data:ArrayBuffer)=>ctx.decodeAudioData(data)}} ,library,(_context:unknown,name:string,options:AudioWorkletNodeOptions)=>new AudioWorkletNode(ctx,name,options))
    // Cached decoded recordings are shared across renders; initialize still uses production loading and wiring.
    library.load=async()=>{};const state=newInstrument();change(state);backend.configure(state);await backend.initialize()
    if(pedalMode){
      const engine=new PianoEngine(backend);engine.state=state
      if(pedalMode==='midi'){const midi=new MidiInput(engine,undefined);midi.message('test',new Uint8Array([0xb0,64,127]))}
      else engine.sustain(pedalMode,true)
      await engine.noteOn('test',60,velocity);engine.noteOff('test')
      if(pedalMode==='off')engine.sustain('off',false)
     }else {backend.start(1,60,velocity,()=>{},{layer:'A',resonate});if(state.layers.B.enabled)backend.start(2,72,velocity,()=>{},{layer:'B',resonate})}
    if(release)backend.release(1)
    const nodes=backend.nodes.size;const pcm=(await ctx.startRendering()).getChannelData(0)
    renders[name]={rms:rms(pcm),tail:rms(pcm.slice(8000)),fingerprint:Array.from(pcm.slice(2000,2100)),nodes,contexts,voices:backend.nodes.size}
    backend.dispose();if(backend.nodes.size||backend.buses.length||backend.chains.length||backend.master||backend.rotary)throw Error('Leaked graph')
    // dispose clears the shared library, so restore recordings below using retained buffers.
    library.entries=entries;library.buffers=new Map(buffers)
   }
   const entries=library.entries,buffers=new Map(library.buffers)
   for(const type of ['Grand','Upright','Electric','Clav','Digital','Misc'])await render(type,s=>{s.layers.A.type=type})
   await render('soft',()=>{},.2);await render('hard',()=>{},1)
   await render('heavy',s=>{s.layers.A.touch=0},.3);await render('light',s=>{s.layers.A.touch=2},.3)
   await render('compressed',s=>{s.layers.A.dynComp=3},.2)
   for(const [key,patch] of Object.entries({timbre:{timbre:3},unison:{unison:3},softRelease:{softRelease:true},stringRes:{stringRes:true}}))await render(key,s=>Object.assign(s.layers.A,patch),.6,key==='softRelease',key==='stringRes')
   await render('release',()=>{},.6,true);await render('muted',s=>{s.master=0});await render('quiet',s=>{s.master=.1});await render('layerQuiet',s=>{s.layers.A.level=.1});await render('twoLayers',s=>{s.layers.B.enabled=true;s.layers.B.type='Digital'})
   await render('rotary',s=>{s.layers.A.effects.ampEq.on=true;s.layers.A.effects.ampEq.type=6;s.rotary.on=true;s.rotary.fast=true})
   await render('delay',s=>{Object.assign(s.layers.A.effects.delay,{on:true,rate:.1,wet:.7})})
   await render('bypassed',s=>{Object.assign(s.layers.A.effects.delay,{on:true,rate:.1,wet:.7});s.effectsOn=false})
   await render('mutedAll',s=>{s.layers.B.enabled=true;s.master=0;s.layers.A.effects.delay.on=true;s.layers.A.effects.ampEq.on=true;s.layers.A.effects.ampEq.type=6;s.rotary.on=true})
   for(const mode of ['ui','keyboard','midi','off'])await render(`pedal-${mode}`,s=>{s.layers.B.enabled=true;s.layers.B.octave=12;s.layers.B.sustped=false},.6,false,false,mode)
   library.failures.set('Grand','Simulated missing bundled asset');library.status='fallback';await render('fallback',()=>{});library.failures.clear();library.status='ready'
   for(let level=0;level<4;level++)await render(`dyn-${level}`,s=>{s.layers.A.dynComp=level},.25)
   for(let level=0;level<4;level++)await render(`unison-${level}`,s=>{s.layers.A.unison=level})
   for(let level=0;level<6;level++)await render(`electric-timbre-${level}`,s=>{s.layers.A.type='Electric';s.layers.A.timbre=level})
   library.clear();return {renders,recordings:entries.length,libraryStatus:library.status}
  })
  const r=result.renders
  expect(result.recordings).toBe(183);expect(result.libraryStatus).toBe('ready')
  for(const type of ['Grand','Upright','Electric','Clav','Digital','Misc']){expect(r[type].rms,type).toBeGreaterThan(.001);expect(r[type].contexts).toBe(1)}
  for(const a of ['Grand','Upright','Electric'])for(const b of ['Grand','Upright','Electric'])if(a!==b)expect(r[a].fingerprint).not.toEqual(r[b].fingerprint)
  expect(r.hard.rms).toBeGreaterThan(r.soft.rms*2);expect(r.light.rms).toBeGreaterThan(r.heavy.rms);expect(r.compressed.rms).toBeGreaterThan(r.soft.rms)
  expect(r.timbre.fingerprint).not.toEqual(r.Grand.fingerprint);expect(r.unison.fingerprint).not.toEqual(r.Grand.fingerprint);expect(r.stringRes.fingerprint).not.toEqual(r.Grand.fingerprint)
  expect(r.release.tail).toBe(0);expect(r.softRelease.rms).toBeGreaterThan(r.release.rms);expect(r.Grand.tail).toBeGreaterThan(.001)
  expect(r.muted.rms).toBe(0);expect(r.mutedAll.rms).toBe(0);expect(r.fallback.rms).toBeGreaterThan(.001);
  for(const mode of ['ui','keyboard','midi'])expect(r[`pedal-${mode}`].tail).toBeCloseTo(r.Grand.tail,5);expect(r['pedal-off'].tail).toBe(0);
  for(let level=1;level<4;level++){expect(r[`dyn-${level}`].rms).toBeGreaterThan(r[`dyn-${level-1}`].rms);expect(r[`unison-${level}`].fingerprint).not.toEqual(r[`unison-${level-1}`].fingerprint)}
  for(let a=0;a<6;a++)for(let b=a+1;b<6;b++)expect(r[`electric-timbre-${a}`].fingerprint).not.toEqual(r[`electric-timbre-${b}`].fingerprint);
  expect(r.quiet.rms).toBeLessThan(r.Grand.rms);expect(r.layerQuiet.rms).toBeLessThan(r.Grand.rms);expect(r.twoLayers.nodes).toBe(2);expect(r.twoLayers.rms).toBeGreaterThan(r.Grand.rms)
  expect(r.rotary.fingerprint).not.toEqual(r.Grand.fingerprint);expect(r.delay.fingerprint).not.toEqual(r.Grand.fingerprint);expect(r.bypassed.fingerprint).toEqual(r.Grand.fingerprint)
 },120000)
 it('reports an actual corrupt recorded asset, flashes only the failed model and recovers on retry',async()=>{
  await page.setViewportSize({width:1440,height:900});await page.reload()
  await page.route('**/samples/grand/A1v14.flac',route=>route.fulfill({status:200,contentType:'audio/flac',body:'corrupt recording'}))
  await page.getByRole('button',{name:'Enable audio',exact:true}).click()
  await page.locator('.audio-state').filter({hasText:'playable synthesis fallback'}).waitFor({timeout:30000})
  expect(await page.locator('.type-labels').getAttribute('class')).toContain('sample-failure');expect(await page.locator('.program-oled').textContent()).toContain('SAMPLE FAILED')
  await page.locator('#piano-piano-type').click();expect(await page.locator('.type-labels').getAttribute('class')).not.toContain('sample-failure');expect(await page.locator('.program-oled').textContent()).toContain('Upright KW')
  await page.unroute('**/samples/grand/A1v14.flac');await page.getByRole('button',{name:'Retry samples',exact:true}).click();await page.locator('.audio-state').filter({hasText:'Ready · bundled recorded piano library'}).waitFor({timeout:30000});expect(errors).toEqual([])
 },60000)
 it('preserves chassis geometry, excluded controls, focus feedback and playable browser inputs',async()=>{
  await page.reload();await page.waitForSelector('.instrument')
  const measure=()=>page.evaluate(()=>({keys:document.querySelectorAll('.piano-key').length,white:document.querySelectorAll('.piano-key.white').length,oled:[...document.querySelectorAll('.oled')].map(e=>e.closest('[data-section]')?.getAttribute('data-section')),width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,chassis:document.querySelector('.instrument')!.getBoundingClientRect().toJSON(),ratio:document.querySelector('.deck')!.getBoundingClientRect().height/document.querySelector('.instrument')!.getBoundingClientRect().height,reach:[...document.querySelectorAll('.hardware-control input,.hardware-control button')].every(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit)})}))
  const desktop=await measure();expect(desktop.keys).toBe(73);expect(desktop.white).toBe(43);expect(desktop.oled).toEqual(['program','synth']);expect(desktop.ratio).toBeCloseTo(.54,3);expect(desktop.reach).toBe(true);expect(desktop.height).toBe(900)
  await page.locator('#piano-piano-type').click();expect(await page.locator('.program-oled').textContent()).toContain('Upright KW');await page.locator('#piano-layer-b-on').click();expect(await page.locator('.program-oled').textContent()).toContain('PIANO B')
  expect(await page.locator('#organ-preset').getAttribute('title')).toContain('presentation only');await page.locator('#organ-preset').click();expect(await page.locator('#organ-preset').getAttribute('aria-pressed')).toBe('true');await page.locator('#organ-organ-model').click();expect(await page.locator('#organ-organ-model').getAttribute('title')).toContain('B3 Bass')
  await page.getByRole('button',{name:'Enable audio',exact:true}).click();await page.locator('.audio-state').filter({hasText:/Ready|fallback|error/}).waitFor({timeout:30000});expect(await page.locator('.audio-state').textContent()).toContain('Ready · bundled recorded piano library')
  await page.locator('body').click({position:{x:10,y:10}});await page.keyboard.down('a');await page.locator('#key-60[aria-pressed=true]').waitFor();await page.keyboard.up('a');expect(await page.locator('#key-60').getAttribute('aria-pressed')).toBe('false')
  await page.keyboard.down('Space');expect(await page.getByRole('button',{name:'Sustain on',exact:true}).getAttribute('aria-pressed')).toBe('true');await page.keyboard.up('Space');await page.getByRole('button',{name:'All notes off',exact:true}).click()
  await page.reload();await page.setViewportSize({width:390,height:844});const narrow=await measure();expect(narrow.keys).toBe(73);expect(narrow.width).toBe(390);expect(narrow.chassis.x+narrow.chassis.width).toBeLessThanOrEqual(390)
  await page.getByLabel('Inspect',{exact:true}).fill('4');await page.locator('.instrument-viewport').evaluate(e=>e.scrollLeft=e.scrollWidth);expect((await page.locator('#key-100').boundingBox())!.x).toBeLessThan(390);await page.getByRole('button',{name:'Fit',exact:true}).click()
  expect(errors).toEqual([])
 },60000)
})
