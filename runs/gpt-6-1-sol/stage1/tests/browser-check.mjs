import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
process.env.PLAYWRIGHT_BROWSERS_PATH=new URL('../.browsers',import.meta.url).pathname
const { chromium } = await import('@playwright/test')
const browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:1440,height:900}})
const consoleErrors=[]
page.on('pageerror',error=>consoleErrors.push(String(error)))
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())})
await page.goto('http://127.0.0.1:5173/')
await page.waitForSelector('.instrument')
const measure=()=>page.evaluate(()=> {
  const rect=selector=> { const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height} }
  return {viewport:{width:innerWidth,height:innerHeight},chassis:rect('.instrument'),deck:rect('.deck'),keybed:rect('.keybed'),sections:[...document.querySelectorAll('[data-section]')].map(s=>({id:s.dataset.section,width:s.getBoundingClientRect().width})),totalKeys:document.querySelectorAll('.piano-key').length,whiteKeys:document.querySelectorAll('.piano-key.white').length,blackKeys:document.querySelectorAll('.piano-key.black').length,blackHeightRatio:document.querySelector('.piano-key.black').getBoundingClientRect().height/document.querySelector('.piano-key.white').getBoundingClientRect().height,controls:document.querySelectorAll('[data-control-id]').length,oledLocations:[...document.querySelectorAll('.oled')].map(e=>e.closest('[data-section]').dataset.section),pageScroll:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}}
})
const desktop=await measure()
assert.equal(desktop.totalKeys,73);assert.equal(desktop.whiteKeys,43);assert.equal(desktop.blackKeys,30)
assert(desktop.chassis.width/1440>=.88&&desktop.chassis.width/1440<=.97)
assert(desktop.chassis.y+desktop.chassis.height<900);assert.equal(desktop.pageScroll.height,900)
assert(Math.abs(desktop.deck.height/desktop.chassis.height-.54)<.002)
assert.deepEqual(desktop.oledLocations,['program','synth'])
const reachability=await page.evaluate(()=>[...document.querySelectorAll('.hardware-control input,.hardware-control button')].map(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id:e.id,reachable:hit===e||e.contains(hit)}}))
assert(reachability.every(c=>c.reachable),JSON.stringify(reachability.filter(c=>!c.reachable)))
let buttons=0;let sliders=0
for(const {id} of reachability) {
  const control=page.locator(`#${id}`)
  await control.focus()
  if(await control.evaluate(e=>e.tagName==='BUTTON')) {
    const before=await control.getAttribute('aria-pressed');await page.keyboard.press('Space');assert.notEqual(await control.getAttribute('aria-pressed'),before,id);buttons++
    await page.keyboard.press('Enter');assert.equal(await control.getAttribute('aria-pressed'),before,id)
  } else {
    const before=Number(await control.inputValue());await page.keyboard.press('ArrowUp');assert.equal(Number(await control.inputValue()),Math.min(100,before+1),id);sliders++
    await page.keyboard.press('ArrowDown');assert.equal(Number(await control.inputValue()),before,id)
  }
}
// Pointer click and dragging move a knob and physical fader, then restore their canonical positions.
const knob=page.locator('#performance-master-level');const kb=await knob.boundingBox();const originalKnob=await knob.inputValue()
await page.mouse.move(kb.x+kb.width/2,kb.y+kb.height/2);await page.mouse.down();await page.mouse.move(kb.x+kb.width/2,kb.y-10);await page.mouse.up();assert.notEqual(await knob.inputValue(),originalKnob)
await knob.fill(originalKnob)
const fader=page.locator('#organ-layer-a-level');const fb=await fader.boundingBox();const originalFader=await fader.inputValue()
await page.mouse.move(fb.x+fb.width/2,fb.y+fb.height/2);await page.mouse.down();await page.mouse.move(fb.x+fb.width/2,fb.y+fb.height);await page.mouse.up();assert.notEqual(await fader.inputValue(),originalFader);await fader.fill(originalFader)
// Real browser audio activation and key input; no speakers or MIDI hardware needed.
await page.getByRole('button',{name:'Enable audio',exact:true}).click()
await page.getByRole('status').filter({hasText:'Ready · synthesized piano'}).waitFor()
await page.locator('body').click({position:{x:10,y:10}})
await page.keyboard.down('a');await page.locator('#key-60[aria-pressed=true]').waitFor();await page.keyboard.up('a');assert.equal(await page.locator('#key-60').getAttribute('aria-pressed'),'false')
await page.keyboard.down('Space');assert.equal(await page.getByRole('button',{name:'Sustain on',exact:true}).getAttribute('aria-pressed'),'true');await page.keyboard.up('Space')
await page.locator('#key-64').focus();await page.keyboard.down('Enter');await page.locator('#key-64[aria-pressed=true]').waitFor();await page.keyboard.up('Enter')
// Native browser touch dispatch creates independent owners; cancel one owner, then cancel the device touch sequence.
const cBox=await page.locator('#key-60').boundingBox();const eBox=await page.locator('#key-64').boundingBox()
const cTouch={x:cBox.x+cBox.width/2,y:cBox.y+cBox.height*.85,id:101};const eTouch={x:eBox.x+eBox.width/2,y:eBox.y+eBox.height*.85,id:102}
const cdp=await page.context().newCDPSession(page)
await page.evaluate(()=>{window.touchOwners={};window.addEventListener('pointerdown',e=>{window.touchOwners[e.target.id]=e.pointerId},true)})
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[cTouch,eTouch]})
await page.locator('#key-60[aria-pressed=true]').waitFor();await page.locator('#key-64[aria-pressed=true]').waitFor()
const cOwner=await page.evaluate(()=>window.touchOwners['key-60'])
await page.locator('#key-60').dispatchEvent('pointercancel',{pointerId:cOwner,pointerType:'touch'})
await page.locator('#key-60[aria-pressed=false]').waitFor({timeout:2000});assert.equal(await page.locator('#key-64').getAttribute('aria-pressed'),'true')
await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]})
await page.locator('#key-64[aria-pressed=false]').waitFor()
await page.mouse.move(cTouch.x,cTouch.y);await page.mouse.down();await page.locator('#key-60[aria-pressed=true]').waitFor()
await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.locator('#key-60[aria-pressed=false]').waitFor();await page.mouse.up()
// Render the actual backend graph offline. The only adapter is context lifecycle;
// the generated PCM, gains, compressor and connections are the production graph.
const offlineAudio=await page.evaluate(async()=> {
  const {WebAudioBackend}=await import('/src/audio.ts')
  const rms=pcm=>Math.sqrt(pcm.reduce((sum,v)=>sum+v*v,0)/pcm.length)
  const render=async(velocity,release,master)=> {
    const context=new OfflineAudioContext(1,8000,8000);const gains=[]
    const backend=new WebAudioBackend(()=>({state:'running',sampleRate:8000,currentTime:0,destination:context.destination,
      resume:async()=>{},close:async()=>{},createGain:()=>{const g=context.createGain();gains.push(g);return g},
      createDynamicsCompressor:()=>context.createDynamicsCompressor(),createBufferSource:()=>context.createBufferSource(),createBuffer:(...args)=>context.createBuffer(...args)}))
    await backend.initialize();if(master!==undefined)gains[0].gain.value=master
    backend.start(1,60,velocity,()=>{});if(release)backend.release(1)
    const pcm=(await context.startRendering()).getChannelData(0);backend.dispose();return {rms:rms(pcm),tail:rms(pcm.slice(4000))}
  }
  return {soft:await render(.3,false),hard:await render(1,false),release:await render(1,true),mutedMaster:await render(1,false,0)}
})
assert(offlineAudio.soft.rms>.001);assert(offlineAudio.hard.rms>offlineAudio.soft.rms*2)
assert(offlineAudio.hard.tail>.001);assert.equal(offlineAudio.release.tail,0);assert.equal(offlineAudio.mutedMaster.rms,0)
// Capture the canonical initial presentation, rather than test-altered focus/audio status.
await page.reload();await page.waitForSelector('.instrument');await page.screenshot({path:'stage1-desktop.png'})
await page.setViewportSize({width:390,height:844});const narrow=await measure()
assert.equal(narrow.pageScroll.width,390);assert.equal(narrow.pageScroll.height,844);assert(narrow.chassis.x>=0&&narrow.chassis.x+narrow.chassis.width<=390)
assert.equal(narrow.totalKeys,73);await page.screenshot({path:'stage1-narrow.png'})
await page.getByLabel('Inspect',{exact:true}).fill('4')
const enlarged=await measure();assert(enlarged.chassis.width>1400);assert.equal(enlarged.pageScroll.width,390)
await page.locator('.instrument-viewport').evaluate(e=>e.scrollLeft=e.scrollWidth)
const lastKey=await page.locator('#key-100').boundingBox();assert(lastKey.x<390&&lastKey.x+lastKey.width>0)
await page.getByRole('button',{name:'Fit',exact:true}).click();assert((await measure()).chassis.width<390)
assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors))
const evidence={phase:1,variant:'stage-4-73',captureMethod:'Candidate Playwright runner; parent harness absent from isolated workspace',browser:await browser.version(),desktop,narrow,offlineAudio,interaction:{buttonsKeyboardChecked:buttons,slidersKeyboardChecked:sliders,pointerReachability:reachability.length,knobDrag:true,faderDrag:true,computerKeys:true,sustain:true,independentTouchOwners:true,cancelAndBlur:true,narrowZoomAndScroll:true},consoleErrors}
await writeFile('stage1-capture.json',JSON.stringify(evidence,null,2)+'\n')
console.log(JSON.stringify(evidence,null,2))
await browser.close()
