import { Instrument } from './components/instrument'
import { useInstrument } from './state/instrument'

export default function App() {
  const instrument = useInstrument()
  return (
    <div className="app-shell">
      <Instrument instrument={instrument} />
    </div>
  )
}
