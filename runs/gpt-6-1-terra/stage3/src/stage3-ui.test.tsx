import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import App from './App'
afterEach(cleanup)
it('browses factory programs and discards unsaved piano edits', () => {
 const {container} = render(<App />)
 const program = screen.getByLabelText('Program list')
 fireEvent.change(program, {target: {value: '2'}})
 expect(container.querySelector('.program-oled')).toHaveTextContent('Electric')
 fireEvent.click(container.querySelector('#piano-0')!)
 expect(container.querySelector('.program-oled')).toHaveTextContent('E')
 fireEvent.change(program, {target: {value: '1'}})
 fireEvent.change(program, {target: {value: '2'}})
 expect(container.querySelector('.program-oled')).toHaveTextContent('Electric')
})
it('edits split zones, switches scenes and enables voices', () => {
 render(<App />)
 const split = screen.getByText('Split and performance settings').closest('details')!
 fireEvent.change(within(split).getByLabelText('Split points'), {target: {value: '1'}})
 expect(within(split).getByLabelText('Split 1')).toBeInTheDocument()
 fireEvent.change(within(split).getByLabelText('Width'), {target: {value: '6'}})
 fireEvent.click(within(split).getByRole('button', {name: 'Scene I'}))
 expect(within(split).getByRole('button', {name: 'Scene II'})).toBeInTheDocument()
 const organ = screen.getByText('Organ A').closest('fieldset')!
 fireEvent.click(within(organ).getByLabelText('Enabled'))
 expect(within(organ).getByLabelText('Enabled')).toBeChecked()
})
it('stores a named sound and recalls it after leaving the slot', () => {
 const {container} = render(<App />)
 const list = screen.getByLabelText('Program list')
 fireEvent.change(list, {target: {value: '7'}})
 const synth = screen.getByText('Synth A').closest('fieldset')!
 const waveform = within(synth).getByLabelText(/^Waveform/)
 fireEvent.change(waveform, {target: {value: 'FM 2-op'}})
 fireEvent.change(screen.getByLabelText('Store As name'), {target: {value: 'My FM'}})
 fireEvent.click(screen.getByRole('button', {name: 'Store As'}))
 fireEvent.change(list, {target: {value: '0'}}); fireEvent.change(list, {target: {value: '7'}})
 expect(within(synth).getByLabelText(/^Waveform/)).toHaveValue('FM 2-op')
 expect(container.querySelector('.program-oled')).toHaveTextContent('My FM')
})
it('automatically retains Live slot edits and supports morph assignment', () => {
 const {container} = render(<App />)
 fireEvent.click(container.querySelector('#morph-6')!)
 expect(container.querySelector('.program-oled')).toHaveTextContent('LIVE')
 fireEvent.click(container.querySelector('#piano-0')!)
 fireEvent.click(container.querySelector('#program-button-1')!)
 fireEvent.click(container.querySelector('#program-button-0')!)
 expect(container.querySelector('.program-oled')).toHaveTextContent('Kawai Upright')
 fireEvent.click(container.querySelector('#morph-0')!)
 fireEvent.change(container.querySelector('#drawbar-0')!, {target: {value: '95'}})
 expect(container.querySelector('.morph-assigned')).toBeInTheDocument()
 fireEvent.click(container.querySelector('#morph-0')!, {shiftKey: true})
 expect(container.querySelector('.morph-assigned')).not.toBeInTheDocument()
})
