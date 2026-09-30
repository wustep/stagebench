import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import App from './App'
import {hardware,keys,sections,initialHardware,setPresentation} from './hardware'
import {functional} from './panel'
import {TestBackend} from './test-backend'
afterEach(cleanup)
const tick=async()=>{await act(async()=>{await Promise.resolve();await Promise.resolve()})}
describe('variant and complete normalized surface',()=> {
  it('models 73 sequential E1–E7 keys, 43 white and 30 black with proper placement',()=> {
    expect(keys).toHaveLength(73);expect(keys[0].name).toBe('E1');expect(keys[72].name).toBe('E7')
    expect(keys.filter(k=>!k.black)).toHaveLength(43);expect(keys.filter(k=>k.black)).toHaveLength(30)
    expect(keys.filter(k=>!k.black).map(k=>k.left)).toEqual(Array.from({length:43},(_,i)=>i/43*100))
    keys.forEach((k,i)=>expect(k.note).toBe(i+28)); expect(keys[72].left+keys[72].width).toBeCloseTo(100)
    render(<App backend={new TestBackend()}/>);expect(document.querySelectorAll('.piano-key')).toHaveLength(73)
  })
  it('renders six ordered bands using photo-corrected widths and exactly two primary OLEDs',()=> {
    render(<App backend={new TestBackend()}/>);const elements=[...document.querySelectorAll<HTMLElement>('[data-section]')]
    expect(elements.map(el=>el.dataset.section)).toEqual(sections.map(s=>s.id))
    expect(elements.map(el=>el.style.width)).toEqual(['14%','20%','8.5%','12.5%','25%','20%'])
    expect(sections.reduce((sum,s)=>sum+s.fraction,0)).toBeCloseTo(1)
    expect(document.querySelectorAll('.oled')).toHaveLength(2);expect(document.querySelector('.program .oled')).toBeTruthy();expect(document.querySelector('.synth .oled')).toBeTruthy()
    expect(document.querySelectorAll('.organ .drawbar')).toHaveLength(9);expect(document.querySelector('.performance .wheel')).toBeTruthy();expect(document.querySelector('.performance .stick')).toBeTruthy()
    expect(screen.getByTestId('deck').parentElement).toBe(screen.getByTestId('chassis'));expect(screen.getByTestId('keybed').parentElement).toBe(screen.getByTestId('chassis'))
  })
  it('gives every physical control a unique stable ID, name and mutable normalized presentation value without audio effects',()=> {
    const b=new TestBackend();render(<App backend={b}/>);expect(new Set(hardware.map(c=>c.id)).size).toBe(hardware.length)
    expect(hardware.length).toBeGreaterThanOrEqual(140)
    for(const c of hardware) {
      const element=document.getElementById(c.id)!;expect(element).toHaveAccessibleName(`${c.section} ${c.label}${functional(c.id)?'':' (decorative)'}`)
      if(functional(c.id)) {expect(element).toHaveAttribute('title');continue}
      if(c.kind==='button') { fireEvent.click(element);expect(element).toHaveAttribute('aria-pressed','true');fireEvent.click(element);expect(element).toHaveAttribute('aria-pressed','false') }
      else { fireEvent.change(element,{target:{value:'90'}});expect(element).toHaveValue('90');expect(element).toHaveAttribute('min','0');expect(element).toHaveAttribute('max','100') }
    }
    expect(b.nodes.size).toBe(0);expect(screen.getByRole('status')).toHaveTextContent('Audio idle')
    const before=initialHardware();expect(setPresentation(before,hardware[0].id,180)[hardware[0].id]).toBe(100);expect(before[hardware[0].id]).not.toBe(100)
  })
})
describe('independent key inputs and cleanup',()=> {
  it('holds two pointer owners independently, cancels one and releases the other',async()=> {
    // jsdom lacks PointerEvent; install a deterministic event boundary.
    class Pointer extends MouseEvent { pointerId:number;constructor(type:string,options:PointerEventInit={}){super(type,options);this.pointerId=options.pointerId??0} }
    vi.stubGlobal('PointerEvent',Pointer)
    const b=new TestBackend();const view=render(<App backend={b}/>);const c=screen.getByRole('button',{name:'Piano key C4'});const d=screen.getByRole('button',{name:'Piano key D4'})
    vi.spyOn(c,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,25,200));vi.spyOn(d,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,25,200));fireEvent.pointerDown(c,{pointerId:1,clientY:150});fireEvent.pointerDown(d,{pointerId:2,clientY:50});await tick();expect(b.nodes.size).toBe(2)
    expect(c).toHaveAttribute('aria-pressed','true');expect(d).toHaveAttribute('aria-pressed','true')
    fireEvent.pointerCancel(c,{pointerId:1});expect(c).toHaveAttribute('aria-pressed','false');expect(d).toHaveAttribute('aria-pressed','true')
    fireEvent.pointerUp(d,{pointerId:2});expect(b.releases).toHaveLength(2)
    view.unmount();expect(b.nodes.size).toBe(0);expect(b.disposed).toBe(true);vi.unstubAllGlobals()
  })
  it('plays focused keys using Enter; blur releases ownership and global blur clears all voices',async()=> {
    const b=new TestBackend();render(<App backend={b}/>);const c=screen.getByRole('button',{name:'Piano key C4'})
    fireEvent.keyDown(c,{code:'Enter'});await tick();expect(b.nodes.size).toBe(1)
    fireEvent.keyDown(c,{code:'Enter',repeat:true});await tick();expect(b.nodes.size).toBe(1)
    fireEvent.blur(c);expect(b.releases).toHaveLength(1)
    fireEvent.keyDown(window,{code:'KeyS'});await tick();expect(b.nodes.size).toBe(2)
    fireEvent.blur(window);expect(b.nodes.size).toBe(0)
  })
  it('provides truthful status, playable synthesis, sustain UI and fit/inspect controls',async()=> {
    const b=new TestBackend();render(<App backend={b}/>);fireEvent.click(screen.getByRole('button',{name:'Enable audio'}));await tick()
    expect(screen.getByRole('status')).toHaveTextContent('Ready · synthesized piano')
    fireEvent.click(screen.getByRole('button',{name:'Sustain off'}));expect(screen.getByRole('button',{name:'Sustain on'})).toHaveAttribute('aria-pressed','true')
    fireEvent.click(screen.getByRole('button',{name:'All notes off'}));expect(screen.getByRole('button',{name:'Sustain off'})).toHaveAttribute('aria-pressed','false')
    fireEvent.change(screen.getByLabelText('Inspect'),{target:{value:'3'}});expect(screen.getByTestId('chassis')).toHaveStyle({width:'300%'})
    fireEvent.click(screen.getByRole('button',{name:'Fit'}));expect(screen.getByTestId('chassis')).toHaveStyle({width:'100%'})
    expect(screen.getByText(/Piano, Organ, Synth and Programs are active/)).toBeInTheDocument()
  })
})
