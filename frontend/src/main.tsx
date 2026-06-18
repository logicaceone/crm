import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Show loader for at least 600ms so styles/fonts have time to load
const loaderStart = performance.now()

function hideAppLoader() {
  const loader = document.getElementById('app-loader')
  if (!loader) return
  loader.classList.add('fade-out')
  setTimeout(() => loader.remove(), 280)
}

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const elapsed = performance.now() - loaderStart
    const remaining = Math.max(0, 600 - elapsed)
    if (remaining > 0) {
      setTimeout(hideAppLoader, remaining)
    } else {
      hideAppLoader()
    }
  })
})
