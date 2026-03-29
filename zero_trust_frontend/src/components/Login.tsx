import { useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { InputText } from 'primereact/inputtext';
import { Toast } from 'primereact/toast';

import { loginUser } from '../services/api';

type CurrentUser = {
  userId: number;
  username: string;
  publicKeySign: string;
  publicKeyEncrypt: string;
};

type LoginProps = {
  onLoggedIn: (user: CurrentUser) => void;
};

export default function Login({ onLoggedIn }: LoginProps) {
  const toast = useRef<Toast>(null);
  const [username, setUsername] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    const normalized = username.trim();
    if (!normalized) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Username Required',
        detail: 'Please enter your username.',
        life: 2500,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await loginUser({ username: normalized });
      const user: CurrentUser = {
        userId: response.user_id,
        username: response.username,
        publicKeySign: response.public_key_sign,
        publicKeyEncrypt: response.public_key_encrypt,
      };

      localStorage.setItem('zt_current_user', JSON.stringify(user));
      onLoggedIn(user);

      toast.current?.show({
        severity: 'success',
        summary: 'Logged In',
        detail: 'Existing user session restored.',
        life: 2500,
      });
    } catch (error) {
      toast.current?.show({
        severity: 'error',
        summary: 'Login Failed',
        detail: error instanceof Error ? error.message : 'Unable to login.',
        life: 3500,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card title="Login With Existing Username" className="register-card">
      <Toast ref={toast} position="top-right" />
      <div className="form-grid">
        <label htmlFor="login-username" className="field-label">
          Username
        </label>
        <InputText
          id="login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="alice"
          className="w-full"
        />

        <Button
          label={isSubmitting ? 'Logging in...' : 'Login'}
          loading={isSubmitting}
          onClick={() => void handleLogin()}
        />
      </div>
    </Card>
  );
}
