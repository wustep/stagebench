import { Stage } from './components/Stage'
import { InstrumentProvider, type InstrumentDeps } from './state/instrument-context'
import './styles.css'

export default function App({ deps }: { deps?: InstrumentDeps }) {
  return (
    <InstrumentProvider deps={deps}>
      <Stage />
    </InstrumentProvider>
  )
}
