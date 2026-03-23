import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router'
import './globals.css'
import Hub from './routes/hub'
import Console from './routes/console'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/console/:agentId" element={<Console />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
