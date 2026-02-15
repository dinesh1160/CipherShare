import { useEffect, useState } from 'react';
import { testConnection } from './services/api';
import UploadTemplate from './components/fileupload';
import './App.css';

function App() {
  const [backendStatus, setBackendStatus] = useState<string>('Not connected');

  useEffect(() => {
    testConnection().then((data) => {
      if (data) {
        setBackendStatus(`Connected: ${data.message}`);
      } else {
        setBackendStatus('Connection failed');
      }
    });
  }, []);

  return (
    <div className="App">
      <h1>Zero Trust File Sharing</h1>
      <p>Backend Status: {backendStatus}</p>
      <UploadTemplate />
    </div>
  );
}

export default App;
