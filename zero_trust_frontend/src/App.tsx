import { useEffect, useState } from 'react';
import { testConnection } from './services/api';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import Register from './components/Register';
import Login from './components/Login';
import FileUpload from './components/FileUpload';
import FileList from './components/FileList';
import type { MyFileItem } from './services/api';
import './App.css';

type CurrentUser = {
  userId: number;
  username: string;
  publicKeySign: string;
  publicKeyEncrypt: string;
};

function App() {
  const [backendStatus, setBackendStatus] = useState<string>('Not connected');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [files, setFiles] = useState<MyFileItem[]>([]);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  useEffect(() => {
    testConnection().then((data) => {
      if (data) {
        setBackendStatus(`Connected: ${data.message}`);
      } else {
        setBackendStatus('Connection failed');
      }
    });

    const storedUser = localStorage.getItem('zt_current_user');
    if (storedUser) {
      try {
        setCurrentUser(JSON.parse(storedUser) as CurrentUser);
      } catch {
        localStorage.removeItem('zt_current_user');
      }
    }
  }, []);

  const handleLogout = () => {
    if (currentUser) {
      localStorage.removeItem(`zt_encrypted_private_keys_${currentUser.username}`);
    }
    localStorage.removeItem('zt_current_user');
    setCurrentUser(null);
    setFiles([]);
  };

  const handleUploadedFile = () => {
    setFilesRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Zero Trust File Sharing</h1>
        <p className="status-pill">Backend: {backendStatus}</p>
      </header>

      {!currentUser ? (
        <>
          <div className="auth-toggle-row">
            <Button
              label="Login"
              outlined={authMode !== 'login'}
              onClick={() => setAuthMode('login')}
            />
            <Button
              label="Register"
              outlined={authMode !== 'register'}
              onClick={() => setAuthMode('register')}
            />
          </div>

          {authMode === 'login' ? (
            <Login onLoggedIn={setCurrentUser} />
          ) : (
            <Register onRegistered={setCurrentUser} />
          )}
        </>
      ) : (
        <Card title="Files Dashboard" className="dashboard-card">
          <p>
            <strong>Welcome:</strong> {currentUser.username}
          </p>
          <p>
            <strong>User ID:</strong> {currentUser.userId}
          </p>
          <p>
            <strong>Signing Public Key:</strong> {currentUser.publicKeySign.slice(0, 24)}...
          </p>
          <p>
            <strong>Encryption Public Key:</strong> {currentUser.publicKeyEncrypt.slice(0, 24)}...
          </p>

          <FileUpload
            ownerId={currentUser.userId}
            username={currentUser.username}
            currentUserId={currentUser.userId}
            onUploaded={handleUploadedFile}
          />

          <FileList
            currentUserId={currentUser.userId}
            username={currentUser.username}
            publicSignKeyHex={currentUser.publicKeySign}
            refreshKey={filesRefreshKey}
            onFilesChange={setFiles}
          />

          <p>Total files visible: {files.length}</p>

          <Button label="Log Out" severity="danger" outlined onClick={handleLogout} />
        </Card>
      )}
    </div>
  );
}

export default App;
