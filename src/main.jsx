import './migrateStorage'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { preloadWorkspace } from './bootWorkspace'
import { applyTheme, loadTheme } from './theme'
import 'reactflow/dist/style.css'
import './index.css'

applyTheme(loadTheme())

preloadWorkspace().then(() => import('./App')).then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
