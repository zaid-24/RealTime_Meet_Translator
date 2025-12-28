import { useState, useEffect, useRef } from 'react';
import './App.css';
import { useTranslator } from './hooks/useTranslator';

// Type definition for the exposed electronAPI
declare global {
  interface Window {
    electronAPI: {
      getApiBaseUrl: () => string;
      setOverlayMode: (isOverlay: boolean) => void;
      setClickThrough: (enable: boolean) => void;
      setIgnoreMouseEvents: (ignore: boolean) => void;
      onToggleRecording: (callback: () => void) => () => void;
      onToggleOverlay: (callback: () => void) => () => void;
    }
  }
}

// Constants
// Note: Auto-detect is not fully supported in browser SDK for translation
// Removed it to avoid confusion - users should select their language
const LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'hi-IN', name: 'Hindi' },
  { code: 'ar-SA', name: 'Arabic' },
];

const TARGET_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'hi', name: 'Hindi' },
];

function App() {
  // Logic State (via Hook)
  const { 
    status, 
    transcript, 
    interimText, 
    lastCommitted, 
    errorMessage,
    silenceCommitted,
    latencyMs,
    startTranslator, 
    stopTranslator, 
    clearTranscript,
    resetError
  } = useTranslator();
  
  const [apiStatus, setApiStatus] = useState<string>('Checking API...');
  
  // UI State
  const [sourceLang, setSourceLang] = useState('en-US');
  const [targetLang, setTargetLang] = useState('en');
  const [isOverlay, setIsOverlay] = useState(false);
  const [isClickThrough, setIsClickThrough] = useState(false);
  const [showDemoTips, setShowDemoTips] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isActiveRef = useRef(false); // Track active state for hotkey
  
  // Keep isActiveRef in sync with status
  useEffect(() => {
    isActiveRef.current = status === 'Listening' || status === 'Translating';
  }, [status]);

  // Global hotkey listener (Ctrl+Shift+S) for recording
  useEffect(() => {
    const cleanup = window.electronAPI?.onToggleRecording(() => {
      console.log('Hotkey received, current status:', isActiveRef.current ? 'active' : 'idle');
      if (isActiveRef.current) {
        stopTranslator();
      } else {
        startTranslator(sourceLang, targetLang);
      }
    });
    
    return () => {
      if (cleanup) cleanup();
    };
  }, [sourceLang, targetLang, startTranslator, stopTranslator]);

  // Global hotkey listener (Ctrl+Shift+D) for overlay toggle
  useEffect(() => {
    const cleanup = window.electronAPI?.onToggleOverlay(() => {
      console.log('Overlay hotkey received');
      setIsOverlay(prev => {
        const newState = !prev;
        window.electronAPI.setOverlayMode(newState);
        if (!newState) {
          setIsClickThrough(false);
          window.electronAPI.setClickThrough(false);
        }
        return newState;
      });
    });
    
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // Initial API Check
  useEffect(() => {
    async function checkHealth() {
      try {
        const baseUrl = window.electronAPI?.getApiBaseUrl();
        if (!baseUrl) {
          setApiStatus('API: Error (window.electronAPI missing)');
          return;
        }

        const res = await fetch(`${baseUrl}/health`);
        const data = await res.json();
        if (data.ok) {
          setApiStatus('API: Connected');
        } else {
          setApiStatus(`API: Unexpected Response`);
        }
      } catch (err: any) {
        console.error('API Check Error:', err);
        setApiStatus(`API: Offline`);
      }
    }
    checkHealth();
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  // Handlers
  const handleStart = () => {
    startTranslator(sourceLang, targetLang);
  };

  const handleStop = () => {
    stopTranslator();
  };

  const handleClear = () => {
    clearTranscript();
  };

  const handleCopy = () => {
    const text = transcript.map(t => `[${t.timestamp}] ${t.text}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  const toggleOverlay = () => {
    const newOverlayState = !isOverlay;
    setIsOverlay(newOverlayState);
    window.electronAPI.setOverlayMode(newOverlayState);
    
    // Always reset click-through when toggling modes
    if (!newOverlayState) {
        setIsClickThrough(false);
        window.electronAPI.setClickThrough(false);
    }
  };

  const toggleClickThrough = (checked: boolean) => {
      setIsClickThrough(checked);
      window.electronAPI.setClickThrough(checked);
  };
  
  // Handle mouse events for click-through "holes" if needed in future
  // For now, simple toggle is sufficient per requirements.
  const handleMouseEnter = () => {
      if (isClickThrough) {
          // If we want to allow clicking controls even in click-through mode:
          window.electronAPI.setIgnoreMouseEvents(false);
      }
  };

  const handleMouseLeave = () => {
      if (isClickThrough) {
          window.electronAPI.setIgnoreMouseEvents(true);
      }
  };

  // Renders
  if (isOverlay) {
    const isActive = status === 'Listening' || status === 'Translating';
    return (
      <div className={`overlay-container ${isClickThrough ? 'click-through' : ''}`}>
        <div className="overlay-header">
          <span className="status-dot" style={{ backgroundColor: isActive ? '#4CAF50' : '#888' }} />
          <span className="drag-handle">Live Translator</span>
          <div className="overlay-controls" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <label className="checkbox-label" title="Enable click-through">
              <input 
                type="checkbox" 
                checked={isClickThrough} 
                onChange={e => toggleClickThrough(e.target.checked)} 
              />
              <span style={{ fontSize: '0.8em' }}>Lock</span>
            </label>
            <button className="btn-icon" onClick={toggleOverlay} title="Expand">⤢</button>
          </div>
        </div>
        
        <div className="overlay-content">
          <div className="live-line-overlay">
            {interimText || (isActive ? "Listening..." : "Paused")}
            {silenceCommitted && <span className="silence-indicator-overlay">✓</span>}
          </div>
          {lastCommitted && (
            <div className="last-line-overlay">
              {lastCommitted}
            </div>
          )}
        </div>

        <div className="overlay-footer">
          {status === 'Idle' || status === 'Error' ? (
            <button className="btn-primary btn-sm" onClick={handleStart}>Start</button>
          ) : (
            <button className="btn-danger btn-sm" onClick={handleStop}>Stop</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Custom Title Bar for Frameless Window */}
      <div className="title-bar">
         <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Meeting Translator</span>
         <div style={{ display: 'flex', gap: '5px', WebkitAppRegion: 'no-drag' } as any}>
             <button className="btn-icon" onClick={() => window.close()} style={{color: '#333'}}>×</button>
         </div>
      </div>

      {/* Header */}:
      <header className="app-header">
        <div className="logo-area">
          <h2>Meeting Translator</h2>
          <span className={`status-badge status-${status.toLowerCase()}`}>
            {status}
          </span>
        </div>
        <div className="header-actions">
           {latencyMs && (
             <span className="latency-indicator" title="Approximate processing latency">
               ~{latencyMs}ms
             </span>
           )}
           <span className="api-status" title={apiStatus}>
              {apiStatus.includes('Connected') ? '🟢 API Ready' : '🔴 API Error'}
           </span>
           <div className="demo-tips-wrapper">
             <button 
               className="btn-link" 
               onClick={() => setShowDemoTips(!showDemoTips)}
               title="Demo tips"
             >
               💡 Tips
             </button>
             {showDemoTips && (
               <div className="demo-tips-popup">
                 <strong>Demo Tips:</strong>
                 <ul>
                   <li>Allow microphone permission when prompted</li>
                   <li>Speak clearly and at normal pace</li>
                   <li><kbd>Ctrl+Shift+S</kbd> — toggle recording</li>
                   <li><kbd>Ctrl+Shift+D</kbd> — toggle overlay</li>
                   <li>Select your spoken language for best results</li>
                 </ul>
                 <button className="btn-sm" onClick={() => setShowDemoTips(false)}>Got it!</button>
               </div>
             )}
           </div>
           <button className="btn-secondary" onClick={toggleOverlay}>
             Pop-out Overlay
           </button>
        </div>
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div className="error-banner">
          {errorMessage}
          <button className="close-btn" onClick={resetError}>×</button>
        </div>
      )}

      {/* Controls */}
      <div className="controls-row">
        <div className="control-group">
          <label>Speaker Language</label>
          <select 
            value={sourceLang} 
            onChange={e => setSourceLang(e.target.value)}
            disabled={status !== 'Idle'}
          >
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>

        <div className="arrow">→</div>

        <div className="control-group">
          <label>Translate To</label>
          <select 
            value={targetLang} 
            onChange={e => setTargetLang(e.target.value)}
            disabled={status !== 'Idle'}
          >
            {TARGET_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>

        <div className="action-buttons">
          {status === 'Idle' ? (
            <button className="btn-primary" onClick={handleStart}>Start Listening</button>
          ) : (
            <button className="btn-danger" onClick={handleStop}>Stop</button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="main-area">
        <div className="live-area">
          <span className="live-label">Live:</span>
          <span className="live-text">{interimText}</span>
          {silenceCommitted && (
            <span className="silence-indicator">✓ Silence detected</span>
          )}
        </div>

        <div className="transcript-area" ref={scrollRef}>
          {transcript.length === 0 ? (
            <div className="empty-state">
              Transcript will appear here... 
              <br/>
            </div>
          ) : (
            transcript.map(item => (
              <div key={item.id} className="transcript-item">
                <span className="timestamp">{item.timestamp}</span>
                <span className="text">{item.text}</span>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-left">
           {transcript.length} lines
        </div>
        <div className="footer-right">
          <button className="btn-secondary" onClick={handleClear} disabled={transcript.length === 0}>
            Clear
          </button>
          <button className="btn-secondary" onClick={handleCopy} disabled={transcript.length === 0}>
            Copy Transcript
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;
