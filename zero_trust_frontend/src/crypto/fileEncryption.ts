import sodiumLib from 'libsodium-wrappers-sumo';

const CHUNK_SIZE_BYTES = 1024 * 1024;

export type EncryptedChunk = {
  index: number;
  cipherHex: string;
  headerHex?: string;
  final: boolean;
};

export type EncryptionProgress = {
  phase: 'hashing' | 'encrypting' | 'decrypting';
  processedBytes: number;
  totalBytes: number;
  percent: number;
};

export type EncryptedFilePayload = {
  chunks: EncryptedChunk[];
  hash: string;
  signature: string;
  symmetricKey: string;
  encryptedFilename: string;
};

function asBytes(value: string | Uint8Array, context: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  throw new Error(`${context} returned string output, expected binary bytes.`);
}

function toBytes(value: Uint8Array | string, context: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${context} cannot be empty.`);
  }

  return sodiumLib.from_hex(normalized);
}

function reportProgress(
  onProgress: ((progress: EncryptionProgress) => void) | undefined,
  phase: EncryptionProgress['phase'],
  processedBytes: number,
  totalBytes: number,
): void {
  if (!onProgress) {
    return;
  }

  const safeTotal = Math.max(totalBytes, 1);
  onProgress({
    phase,
    processedBytes,
    totalBytes,
    percent: Math.min(100, Math.round((processedBytes / safeTotal) * 100)),
  });
}

async function encryptFilename(fileName: string, symmetricKey: Uint8Array): Promise<string> {
  await sodiumLib.ready;

  const nonce = asBytes(
    sodiumLib.randombytes_buf(sodiumLib.crypto_secretbox_NONCEBYTES),
    'randombytes filename nonce',
  );
  const cipher = asBytes(
    sodiumLib.crypto_secretbox_easy(fileName, nonce, symmetricKey),
    'crypto_secretbox_easy filename result',
  );

  return `${sodiumLib.to_hex(nonce)}:${sodiumLib.to_hex(cipher)}`;
}

export async function computeSHA256(file: File): Promise<string> {
  const input = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', input);
  const digestHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  console.log('[fileEncryption] Plaintext SHA-256:', digestHex);
  return digestHex;
}

export async function encryptFile(
  file: File,
  signPrivateKey: Uint8Array,
  onProgress?: (progress: EncryptionProgress) => void,
): Promise<EncryptedFilePayload> {
  await sodiumLib.ready;

  reportProgress(onProgress, 'hashing', 0, file.size);
  const hash = await computeSHA256(file);
  reportProgress(onProgress, 'hashing', file.size, file.size);

  const symmetricKey = asBytes(
    sodiumLib.crypto_secretstream_xchacha20poly1305_keygen(),
    'secretstream keygen',
  );

  const initPush = sodiumLib.crypto_secretstream_xchacha20poly1305_init_push(symmetricKey);
  const encryptedFilename = await encryptFilename(file.name, symmetricKey);

  const signature = asBytes(
    sodiumLib.crypto_sign_detached(hash, signPrivateKey),
    'crypto_sign_detached result',
  );

  const chunks: EncryptedChunk[] = [];
  let offset = 0;
  let index = 0;

  while (offset < file.size || (file.size === 0 && index === 0)) {
    const nextOffset = file.size === 0 ? 0 : Math.min(offset + CHUNK_SIZE_BYTES, file.size);
    const plaintextChunk = asBytes(
      new Uint8Array(await file.slice(offset, nextOffset).arrayBuffer()),
      'plaintext chunk',
    );

    const isFinal = file.size === 0 || nextOffset >= file.size;
    const tag = isFinal
      ? sodiumLib.crypto_secretstream_xchacha20poly1305_TAG_FINAL
      : sodiumLib.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;

    const cipher = asBytes(
      sodiumLib.crypto_secretstream_xchacha20poly1305_push(
        initPush.state,
        plaintextChunk,
        null,
        tag,
      ),
      'secretstream push result',
    );

    chunks.push({
      index,
      cipherHex: sodiumLib.to_hex(cipher),
      headerHex: index === 0 ? sodiumLib.to_hex(initPush.header) : undefined,
      final: isFinal,
    });

    index += 1;
    offset = file.size === 0 ? file.size : nextOffset;
    reportProgress(onProgress, 'encrypting', offset, file.size);
  }

  console.log('[fileEncryption] Encryption complete:', {
    file: file.name,
    chunkCount: chunks.length,
    hash,
  });

  return {
    chunks,
    hash,
    signature: sodiumLib.to_hex(signature),
    symmetricKey: sodiumLib.to_hex(symmetricKey),
    encryptedFilename,
  };
}

export async function decryptFile(
  chunks: EncryptedChunk[],
  symmetricKey: Uint8Array | string,
  signature: Uint8Array | string,
  publicSignKey: Uint8Array | string,
  expectedHash: string,
  onProgress?: (progress: EncryptionProgress) => void,
): Promise<File> {
  await sodiumLib.ready;

  if (!chunks.length) {
    throw new Error('No encrypted chunks provided.');
  }

  const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);
  const headerHex = sortedChunks[0].headerHex;
  if (!headerHex) {
    throw new Error('Missing stream header in first encrypted chunk.');
  }

  const symmetricKeyBytes = toBytes(symmetricKey, 'symmetricKey');
  const signatureBytes = toBytes(signature, 'signature');
  const publicSignKeyBytes = toBytes(publicSignKey, 'publicSignKey');

  const signatureValid = sodiumLib.crypto_sign_verify_detached(
    signatureBytes,
    expectedHash,
    publicSignKeyBytes,
  );

  if (!signatureValid) {
    throw new Error('Signature verification failed before decryption. Data cannot be trusted.');
  }

  console.log('[fileEncryption] Signature verified for expected hash.');

  const pullState = sodiumLib.crypto_secretstream_xchacha20poly1305_init_pull(
    sodiumLib.from_hex(headerHex),
    symmetricKeyBytes,
  );

  const plaintextParts: ArrayBuffer[] = [];
  let plaintextBytes = 0;

  for (let i = 0; i < sortedChunks.length; i += 1) {
    const chunk = sortedChunks[i];
    const pulled = sodiumLib.crypto_secretstream_xchacha20poly1305_pull(
      pullState,
      sodiumLib.from_hex(chunk.cipherHex),
      null,
    );

    if (!pulled) {
      throw new Error(`Failed to decrypt chunk ${chunk.index}.`);
    }

    const message = asBytes(pulled.message, `decrypted message chunk ${chunk.index}`);
    const messageCopy: Uint8Array<ArrayBuffer> = new Uint8Array(message.byteLength);
    messageCopy.set(message);
    plaintextParts.push(messageCopy.buffer);
    plaintextBytes += message.byteLength;

    const isLastChunk = i === sortedChunks.length - 1;
    if (isLastChunk && pulled.tag !== sodiumLib.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
      throw new Error('Final chunk missing FINAL stream tag.');
    }

    reportProgress(onProgress, 'decrypting', i + 1, sortedChunks.length);
  }

  const decryptedBlob = new Blob(plaintextParts, { type: 'application/octet-stream' });
  const decryptedFile = new File([decryptedBlob], 'decrypted.bin', {
    type: 'application/octet-stream',
  });

  const computedHash = await computeSHA256(decryptedFile);
  if (computedHash !== expectedHash) {
    throw new Error('Hash mismatch after decryption. File may be tampered or corrupted.');
  }

  console.log('[fileEncryption] Decryption complete:', {
    chunkCount: sortedChunks.length,
    plaintextBytes,
    hash: computedHash,
  });

  return decryptedFile;
}
