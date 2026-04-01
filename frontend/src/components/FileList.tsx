import { useEffect, useMemo, useState } from 'react';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Password } from 'primereact/password';

import { decryptFile, decryptFilename, type EncryptedChunk } from '../crypto/fileEncryption';
import { decryptKeysWithPassphrase, type EncryptedPrivateKeys } from '../crypto/keyManager';
import { downloadFile, getMyFiles, type MyFileItem } from '../services/api';

type FileListProps = {
  currentUserId: number;
  username: string;
  publicSignKeyHex: string;
  refreshKey: number;
  onFilesChange: (files: MyFileItem[]) => void;
};

const CHUNK_DELIMITER = '\n--ZT-CHUNK-END--\n';

export default function FileList({ currentUserId, username, publicSignKeyHex, refreshKey, onFilesChange }: FileListProps) {
  const [files, setFiles] = useState<MyFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadState, setDownloadState] = useState<Record<number, boolean>>({});
  const [displayNames, setDisplayNames] = useState<Record<number, string>>({});
  const [passphrase, setPassphrase] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isNamesUnlocked, setIsNamesUnlocked] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadFiles = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await getMyFiles(currentUserId);
        setFiles(response);
        onFilesChange(response);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Failed to load files.';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadFiles();
  }, [refreshKey, onFilesChange, currentUserId]);

  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [files],
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const nameTemplate = (row: MyFileItem) => {
    const shown = displayNames[row.id] ?? row.encrypted_filename;
    return <span title={shown}>{truncate(shown, 42)}</span>;
  };

  const sizeTemplate = (row: MyFileItem) => <span>{formatFileSize(row.file_size)}</span>;

  const dateTemplate = (row: MyFileItem) => <span>{new Date(row.created_at).toLocaleString()}</span>;

  const downloadTemplate = (row: MyFileItem) => (
    <Button
      label={downloadState[row.id] ? 'Downloading...' : 'Download'}
      size="small"
      loading={Boolean(downloadState[row.id])}
      onClick={() => void handleDownload(row)}
      disabled={Boolean(downloadState[row.id])}
    />
  );

  const handleDownload = async (file: MyFileItem) => {
    setDownloadState((prev) => ({ ...prev, [file.id]: true }));
    setError('');

    try {
      const response = await downloadFile(file.id, currentUserId);
      const fileHash = response.headers.get('X-File-Hash');
      const signature = response.headers.get('X-Signature');
      const encryptedKey = response.headers.get('X-Encrypted-Key');

      if (!fileHash || !signature || !encryptedKey) {
        throw new Error('Download response missing required verification headers.');
      }

      const payload = await response.arrayBuffer();
      const chunks = parseChunkStream(payload);

      const decrypted = await decryptFile(
        chunks,
        encryptedKey,
        signature,
        publicSignKeyHex,
        fileHash,
      );

      const outputName = `decrypted-file-${file.id}.bin`;
      const url = URL.createObjectURL(decrypted);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = outputName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      console.log('[FileList] Download/decrypt completed', {
        fileId: file.id,
        outputName,
        bytes: decrypted.size,
      });
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : 'Download failed.';
      setError(message);
    } finally {
      setDownloadState((prev) => ({ ...prev, [file.id]: false }));
    }
  };

  const handleUnlockNames = async () => {
    setError('');
    setIsUnlocking(true);

    try {
      const encryptedPrivateKeysRaw = localStorage.getItem(`zt_encrypted_private_keys_${username}`);
      if (!encryptedPrivateKeysRaw) {
        throw new Error('No local private-key bundle found for this user.');
      }

      // Validate passphrase by trying to decrypt local key bundle.
      await decryptKeysWithPassphrase(
        JSON.parse(encryptedPrivateKeysRaw) as EncryptedPrivateKeys,
        passphrase,
      );

      const fileKeyStoreRaw = localStorage.getItem(`zt_file_keys_${username}`);
      const fileKeyStore = fileKeyStoreRaw ? (JSON.parse(fileKeyStoreRaw) as Record<string, string>) : {};

      const nextDisplayNames: Record<number, string> = {};
      for (const file of files) {
        const symmetricKeyHex = fileKeyStore[String(file.id)];
        if (!symmetricKeyHex) {
          continue
        }

        try {
          nextDisplayNames[file.id] = await decryptFilename(file.encrypted_filename, symmetricKeyHex);
        } catch {
          // Keep encrypted name when decryption key is missing/invalid for that file.
        }
      }

      setDisplayNames(nextDisplayNames);
      setIsNamesUnlocked(true);
    } catch (unlockError) {
      const message = unlockError instanceof Error ? unlockError.message : 'Failed to unlock filenames.';
      setError(message);
      setIsNamesUnlocked(false);
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <Card title="My Files" className="files-card">
      <div className="filelist-unlock-row">
        <Password
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          toggleMask
          feedback={false}
          placeholder="Passphrase to unlock names"
          inputClassName="w-full"
          className="w-full"
        />
        <Button
          label={isUnlocking ? 'Unlocking...' : 'Unlock Names'}
          loading={isUnlocking}
          onClick={() => void handleUnlockNames()}
          disabled={isUnlocking}
        />
      </div>

      {isNamesUnlocked ? <p className="upload-status">Filename decryption unlocked locally.</p> : null}
      {error ? <p className="upload-status">{error}</p> : null}
      <DataTable value={sortedFiles} loading={isLoading} paginator rows={5} emptyMessage="No files found.">
        <Column field="encrypted_filename" header="Name" body={nameTemplate} />
        <Column field="file_size" header="Size" body={sizeTemplate} />
        <Column field="created_at" header="Date" body={dateTemplate} />
        <Column header="Action" body={downloadTemplate} />
      </DataTable>
    </Card>
  );
}

function parseChunkStream(payload: ArrayBuffer): EncryptedChunk[] {
  const rawText = new TextDecoder().decode(payload);
  const segments = rawText
    .split(CHUNK_DELIMITER)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (!segments.length) {
    throw new Error('Unable to parse encrypted chunks from download stream.');
  }

  let parsed: EncryptedChunk[];
  try {
    parsed = segments.map((segment) => JSON.parse(segment) as EncryptedChunk);
  } catch {
    throw new Error(
      'Downloaded data is in a legacy format and cannot be reconstructed safely. Please re-upload the file with the latest uploader.',
    );
  }

  if (!parsed[0]?.headerHex) {
    throw new Error('Missing stream header in downloaded first chunk.');
  }

  return parsed;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
