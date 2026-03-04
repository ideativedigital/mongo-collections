import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { RecipePage } from './pages/RecipePage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/recipe/getting-started" replace />} />
        <Route path="/recipes" element={<HomePage />} />
        <Route path="/recipe/:slug" element={<RecipePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
