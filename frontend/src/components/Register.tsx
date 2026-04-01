import { useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Toast } from 'primereact/toast';

import {
  encryptKeysWithPassphrase,
  generateUserKeys,
  keysToHex,
  type EncryptedPrivateKeys,
  type UserKeysHex,
} from '../crypto/keyManager';
import { registerUser } from '../services/api';

type CurrentUser = {
  userId: number;
  username: string;
  publicKeySign: string;
  publicKeyEncrypt: string;
};

type RegisterProps = {
  onRegistered: (user: CurrentUser) => void;
};

export default function Register({ onRegistered }: RegisterProps) {
  const toast = useRef<Toast>(null);
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [generatedHexKeys, setGeneratedHexKeys] = useState<UserKeysHex | null>(null);

  const handleGenerateKeys = async () => {
    setIsGenerating(true);

    try {
      const keyPairs = await generateUserKeys();
      const hexKeys = await keysToHex(keyPairs);
      setGeneratedHexKeys(hexKeys);

      toast.current?.show({
        severity: 'success',
        summary: 'Keys Generated',
        detail: 'Signing and encryption key pairs are ready.',
        life: 3000,
      });
    } catch (error) {
      toast.current?.show({
        severity: 'error',
        summary: 'Key Generation Failed',
        detail: error instanceof Error ? error.message : 'Unexpected error while generating keys.',
        life: 4000,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegister = async () => {
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Username Required',
        detail: 'Please enter a username before registering.',
        life: 3000,
      });
      return;
    }

    if (!generatedHexKeys) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Generate Keys First',
        detail: 'Create key pairs before sending registration.',
        life: 3000,
      });
      return;
    }

    setIsRegistering(true);

    try {
      const response = await registerUser({
        username: normalizedUsername,
        public_key_sign: generatedHexKeys.signPublicKeyHex,
        public_key_encrypt: generatedHexKeys.encryptPublicKeyHex,
      });

      const encryptedPrivateKeys: EncryptedPrivateKeys = await encryptKeysWithPassphrase(
        {
          signPrivateKeyHex: generatedHexKeys.signPrivateKeyHex,
          encryptPrivateKeyHex: generatedHexKeys.encryptPrivateKeyHex,
        },
        passphrase,
      );

      const encryptedStorageKey = `zt_encrypted_private_keys_${normalizedUsername}`;
      localStorage.setItem(encryptedStorageKey, JSON.stringify(encryptedPrivateKeys));

      const userState: CurrentUser = {
        userId: response.user_id,
        username: normalizedUsername,
        publicKeySign: generatedHexKeys.signPublicKeyHex,
        publicKeyEncrypt: generatedHexKeys.encryptPublicKeyHex,
      };

      localStorage.setItem('zt_current_user', JSON.stringify(userState));
      onRegistered(userState);

      toast.current?.show({
        severity: 'success',
        summary: 'Registration Complete',
        detail: 'User registered and encrypted keys saved locally.',
        life: 3000,
      });
    } catch (error) {
      toast.current?.show({
        severity: 'error',
        summary: 'Registration Failed',
        detail: error instanceof Error ? error.message : 'Unexpected registration error.',
        life: 4500,
      });
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <Card title="Create Your Zero Trust Identity" className="register-card">
      <Toast ref={toast} position="top-right" />

      <div className="form-grid">
        <label htmlFor="username" className="field-label">
          Username
        </label>
        <InputText
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="alice"
          className="w-full"
        />

        <label htmlFor="passphrase" className="field-label">
          Passphrase (optional)
        </label>
        <Password
          id="passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          toggleMask
          feedback={false}
          placeholder="Protect private keys"
          inputClassName="w-full"
          className="w-full"
        />

        <div className="button-row">
          <Button
            label={isGenerating ? 'Generating...' : 'Generate Keys'}
            onClick={handleGenerateKeys}
            loading={isGenerating}
            severity="secondary"
          />
          <Button
            label={isRegistering ? 'Registering...' : 'Register'}
            onClick={handleRegister}
            loading={isRegistering}
            disabled={!generatedHexKeys || !username.trim()}
          />
        </div>

        {generatedHexKeys && (
          <div className="key-preview">
            <p>
              <strong>Signing Public Key:</strong> {generatedHexKeys.signPublicKeyHex.slice(0, 24)}...
            </p>
            <p>
              <strong>Encryption Public Key:</strong> {generatedHexKeys.encryptPublicKeyHex.slice(0, 24)}...
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
