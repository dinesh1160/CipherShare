import { useState } from 'react';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Password } from 'primereact/password';
import { ProgressBar } from 'primereact/progressbar';

import { decryptKeysWithPassphrase, type EncryptedPrivateKeys } from '../crypto/keyManager';
import { encryptFile } from '../crypto/fileEncryption';
import { uploadFileChunk } from '../services/api';

export type UploadedFileRecord = {
  fileId: number;
  name: string;
  size: number;
  hash: string;
  uploadedAt: string;
};

type FileUploadProps = {
  ownerId: number;
  username: string;
  onUploaded: (file: UploadedFileRecord) => void;
};

export default function FileUpload({ ownerId, username, onUploaded }: FileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Idle');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setProgress(0);
    setStatus(file ? `Selected: ${file.name}` : 'Idle');
  };

  const handleEncryptAndUpload = async () => {
    if (!selectedFile) {
      setStatus('Please choose a file first.');
      return;
    }

    const encryptedPrivateKeysRaw = localStorage.getItem(`zt_encrypted_private_keys_${username}`);
    if (!encryptedPrivateKeysRaw) {
      setStatus('Encrypted signing keys are missing. Please register again.');
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    try {
      const encryptedPrivateKeys = JSON.parse(encryptedPrivateKeysRaw) as EncryptedPrivateKeys;
      const privateKeys = await decryptKeysWithPassphrase(encryptedPrivateKeys, passphrase);
      const signPrivateKeyBytes = hexToBytes(privateKeys.signPrivateKeyHex, 'signPrivateKeyHex');

      setStatus('Encrypting file...');
      const encryptedPayload = await encryptFile(
        selectedFile,
        signPrivateKeyBytes,
        (encProgress) => {
          setProgress(Math.round(encProgress.percent * 0.5));
        },
      );

      console.log('[FileUpload] Encrypted payload ready', {
        file: selectedFile.name,
        chunkCount: encryptedPayload.chunks.length,
        hash: encryptedPayload.hash,
      });

      let returnedFileId = 0;
      const totalChunks = encryptedPayload.chunks.length;

      setStatus('Uploading encrypted chunks...');
      for (let i = 0; i < totalChunks; i += 1) {
        const chunk = encryptedPayload.chunks[i];
        const formData = new FormData();
        formData.append('encrypted_filename', encryptedPayload.encryptedFilename);
        formData.append('file_hash', encryptedPayload.hash);
        formData.append('signature', encryptedPayload.signature);
        formData.append('file_size', String(selectedFile.size));
        formData.append('owner_id', String(ownerId));
        formData.append('chunk_index', String(chunk.index));
        formData.append('total_chunks', String(totalChunks));
        formData.append(
          'chunk_data',
          new Blob([chunk.cipherHex], { type: 'application/octet-stream' }),
          `chunk-${chunk.index}.bin`,
        );

        if (i === 0) {
          formData.append('owner_encrypted_symmetric_key', encryptedPayload.symmetricKey);
        }

        if (returnedFileId > 0) {
          formData.append('file_id', String(returnedFileId));
        }

        const response = await uploadFileChunk(formData);
        returnedFileId = response.file_id;

        const uploadPercent = Math.round(((i + 1) / totalChunks) * 50);
        setProgress(50 + uploadPercent);
      }

      const uploadedRecord: UploadedFileRecord = {
        fileId: returnedFileId,
        name: selectedFile.name,
        size: selectedFile.size,
        hash: encryptedPayload.hash,
        uploadedAt: new Date().toISOString(),
      };

      onUploaded(uploadedRecord);
      setStatus('Upload complete. Stored encrypted chunks on backend.');
      setSelectedFile(null);
    } catch (error) {
      console.error('[FileUpload] Encrypt & upload failed', error);
      setStatus(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card title="Encrypted File Upload" className="upload-card">
      <div className="form-grid">
        <input type="file" onChange={handleFileChange} className="file-picker" />

        <label htmlFor="upload-passphrase" className="field-label">
          Passphrase to unlock signing key
        </label>
        <Password
          id="upload-passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          toggleMask
          feedback={false}
          placeholder="Enter registration passphrase"
          inputClassName="w-full"
          className="w-full"
        />

        <Button
          label={isProcessing ? 'Processing...' : 'Encrypt & Upload'}
          onClick={handleEncryptAndUpload}
          disabled={!selectedFile || isProcessing}
          loading={isProcessing}
        />

        <ProgressBar value={progress} showValue />
        <p className="upload-status">{status}</p>
      </div>
    </Card>
  );
}

function hexToBytes(hex: string, field: string): Uint8Array {
  const normalized = hex.trim();
  if (!normalized || normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) {
    throw new Error(`Invalid ${field} value.`);
  }

  const result = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    result[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }

  return result;
}
