const API_BASE_URL = 'http://localhost:8080';

export type RegisterUserRequest = {
  username: string;
  public_key_sign: string;
  public_key_encrypt: string;
};

export type RegisterUserResponse = {
  user_id: number;
  message: string;
};

export type UploadFileChunkResponse = {
  file_id: number;
  message?: string;
};

export async function testConnection() {
  try {
    const response = await fetch(`${API_BASE_URL}/ping`);
    const data = await response.json();
    console.log('Backend response:', data);
    return data;
  } catch (error) {
    console.error('Connection failed:', error);
    return null;
  }
}

export async function registerUser(payload: RegisterUserRequest): Promise<RegisterUserResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Registration request failed.';
    throw new Error(message);
  }

  return data as RegisterUserResponse;
}

export async function uploadFileChunk(formData: FormData): Promise<UploadFileChunkResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/files/upload`, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Chunk upload failed.';
    throw new Error(message);
  }

  return data as UploadFileChunkResponse;
}
