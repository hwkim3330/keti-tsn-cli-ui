import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Checksum from './pages/Checksum'
import Download from './pages/Download'
import CatalogList from './pages/CatalogList'
import Encode from './pages/Encode'
import Decode from './pages/Decode'
import Fetch from './pages/Fetch'
import Patch from './pages/Patch'
import GetConfig from './pages/GetConfig'
import Settings from './pages/Settings'
import PTP from './pages/PTP'
import TAS from './pages/TAS'
import QoS from './pages/QoS'

function App() {
  const [transportConfig, setTransportConfig] = useState({
    transport: 'wifi',
    device: '/dev/ttyACM0',
    host: '10.42.0.11',
    port: 5683
  })

  return (
    <Router>
      <div className="app-container">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h1>KETI TSN CLI</h1>
            <p>Switch Configuration UI</p>
          </div>

          <nav>
            <div className="nav-section">
              <div className="nav-section-title">Overview</div>
              <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span>Dashboard</span>
              </NavLink>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">YANG Catalog</div>
              <NavLink to="/checksum" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Checksum</span>
              </NavLink>
              <NavLink to="/download" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Download</span>
              </NavLink>
              <NavLink to="/list" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span>Catalog List</span>
              </NavLink>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">Conversion</div>
              <NavLink to="/encode" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Encode (YAML→CBOR)</span>
              </NavLink>
              <NavLink to="/decode" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span>Decode (CBOR→YAML)</span>
              </NavLink>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">TSN Configuration</div>
              <NavLink to="/ptp" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>PTP (IEEE 1588)</span>
              </NavLink>
              <NavLink to="/tas" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>TAS (Qbv)</span>
              </NavLink>
              <NavLink to="/qos" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>QoS / CBS / PSFP</span>
              </NavLink>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">Device Commands</div>
              <NavLink to="/get" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                <span>Get Config</span>
              </NavLink>
              <NavLink to="/fetch" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>Fetch (iFETCH)</span>
              </NavLink>
              <NavLink to="/patch" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span>Patch (iPATCH)</span>
              </NavLink>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">System</div>
              <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <svg className="nav-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Settings</span>
              </NavLink>
            </div>
          </nav>
        </aside>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard config={transportConfig} />} />
            <Route path="/checksum" element={<Checksum config={transportConfig} />} />
            <Route path="/download" element={<Download config={transportConfig} />} />
            <Route path="/list" element={<CatalogList />} />
            <Route path="/encode" element={<Encode />} />
            <Route path="/decode" element={<Decode />} />
            <Route path="/get" element={<GetConfig config={transportConfig} />} />
            <Route path="/fetch" element={<Fetch config={transportConfig} />} />
            <Route path="/patch" element={<Patch config={transportConfig} />} />
            <Route path="/ptp" element={<PTP config={transportConfig} />} />
            <Route path="/tas" element={<TAS config={transportConfig} />} />
            <Route path="/qos" element={<QoS config={transportConfig} />} />
            <Route path="/settings" element={<Settings config={transportConfig} setConfig={setTransportConfig} />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
