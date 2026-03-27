import sodiumLib from 'libsodium-wrappers-sumo';

export type UserKeyPairs = {
  signKeyPair: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  encryptKeyPair: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
};

export type UserKeysHex = {
  signPublicKeyHex: string;
  signPrivateKeyHex: string;
  encryptPublicKeyHex: string;
  encryptPrivateKeyHex: string;
};

export type EncryptedPrivateKeys = {
  algorithm: 'crypto_secretbox';
  kdf: 'crypto_pwhash';
  saltHex: string;
  nonceHex: string;
  cipherHex: string;
};

function asBytes(value: string | Uint8Array, context: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  throw new Error(`${context} returned string output, expected binary bytes.`);
}

export async function generateUserKeys(): Promise<UserKeyPairs> {
  await sodiumLib.ready;

  const signKeyPair = sodiumLib.crypto_sign_keypair();
  const encryptKeyPair = sodiumLib.crypto_box_keypair();

  return {
    signKeyPair: {
      publicKey: asBytes(signKeyPair.publicKey, 'crypto_sign_keypair publicKey'),
      privateKey: asBytes(signKeyPair.privateKey, 'crypto_sign_keypair privateKey'),
    },
    encryptKeyPair: {
      publicKey: asBytes(encryptKeyPair.publicKey, 'crypto_box_keypair publicKey'),
      privateKey: asBytes(encryptKeyPair.privateKey, 'crypto_box_keypair privateKey'),
    },
  };
}

export async function keysToHex(keys: UserKeyPairs): Promise<UserKeysHex> {
  await sodiumLib.ready;

  return {
    signPublicKeyHex: sodiumLib.to_hex(keys.signKeyPair.publicKey),
    signPrivateKeyHex: sodiumLib.to_hex(keys.signKeyPair.privateKey),
    encryptPublicKeyHex: sodiumLib.to_hex(keys.encryptKeyPair.publicKey),
    encryptPrivateKeyHex: sodiumLib.to_hex(keys.encryptKeyPair.privateKey),
  };
}

export async function hexToKeys(hexKeys: UserKeysHex): Promise<UserKeyPairs> {
  await sodiumLib.ready;

  return {
    signKeyPair: {
      publicKey: sodiumLib.from_hex(hexKeys.signPublicKeyHex),
      privateKey: sodiumLib.from_hex(hexKeys.signPrivateKeyHex),
    },
    encryptKeyPair: {
      publicKey: sodiumLib.from_hex(hexKeys.encryptPublicKeyHex),
      privateKey: sodiumLib.from_hex(hexKeys.encryptPrivateKeyHex),
    },
  };
}

async function deriveSecretKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  await sodiumLib.ready;

  const normalized = passphrase.trim() || '__zero_trust_local_default__';
  return asBytes(
    sodiumLib.crypto_pwhash(
    sodiumLib.crypto_secretbox_KEYBYTES,
    normalized,
    salt,
    sodiumLib.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodiumLib.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodiumLib.crypto_pwhash_ALG_DEFAULT,
    ),
    'crypto_pwhash result',
  );
}

export async function encryptKeysWithPassphrase(
  privateKeys: Pick<UserKeysHex, 'signPrivateKeyHex' | 'encryptPrivateKeyHex'>,
  passphrase: string,
): Promise<EncryptedPrivateKeys> {
  await sodiumLib.ready;

  const salt = sodiumLib.randombytes_buf(sodiumLib.crypto_pwhash_SALTBYTES);
  const nonce = sodiumLib.randombytes_buf(sodiumLib.crypto_secretbox_NONCEBYTES);
  const saltBytes = asBytes(salt, 'randombytes salt');
  const nonceBytes = asBytes(nonce, 'randombytes nonce');
  const secretKey = await deriveSecretKey(passphrase, saltBytes);

  const plaintext = JSON.stringify(privateKeys);
  const cipher = asBytes(
    sodiumLib.crypto_secretbox_easy(plaintext, nonceBytes, secretKey),
    'crypto_secretbox_easy result',
  );

  return {
    algorithm: 'crypto_secretbox',
    kdf: 'crypto_pwhash',
    saltHex: sodiumLib.to_hex(saltBytes),
    nonceHex: sodiumLib.to_hex(nonceBytes),
    cipherHex: sodiumLib.to_hex(cipher),
  };
}

export async function decryptKeysWithPassphrase(
  encrypted: EncryptedPrivateKeys,
  passphrase: string,
): Promise<Pick<UserKeysHex, 'signPrivateKeyHex' | 'encryptPrivateKeyHex'>> {
  await sodiumLib.ready;

  const salt = sodiumLib.from_hex(encrypted.saltHex);
  const nonce = sodiumLib.from_hex(encrypted.nonceHex);
  const cipher = sodiumLib.from_hex(encrypted.cipherHex);

  const secretKey = await deriveSecretKey(passphrase, salt);
  const plaintext = sodiumLib.crypto_secretbox_open_easy(cipher, nonce, secretKey);

  if (!plaintext) {
    throw new Error('Unable to decrypt private keys. Incorrect passphrase or corrupted data.');
  }

  return JSON.parse(sodiumLib.to_string(asBytes(plaintext, 'crypto_secretbox_open_easy result')));
}
