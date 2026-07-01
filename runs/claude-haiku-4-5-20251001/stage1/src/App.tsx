import React from 'react'
import StageBuilder from './components/StageBuilder'
import './App.css'

function App() {
  // Calculate optimal scale for 1440x900 viewport
  // Target: instrument occupies 88-97% of 1440px width
  // This is responsive and will adjust based on actual window size
  const [scale, setScale] = React.useState(1)

  React.useEffect(() => {
    const handleResize = () => {
      const windowWidth = window.innerWidth
      // Target width: 88-97% of viewport, with 88% as minimum
      const targetWidth = windowWidth * 0.92
      // Base instrument width at 1440px: ~1320px (92% of 1440)
      const baseWidth = 1320
      const newScale = targetWidth / baseWidth
      setScale(Math.min(1, newScale)) // Don't scale up past 1
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="app">
      <StageBuilder scale={scale} />
    </div>
  )
}

export default App
