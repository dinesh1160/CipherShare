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

export type LoginUserRequest = {
  username: string;
};

export type LoginUserResponse = {
  user_id: number;
  username: string;
  public_key_sign: string;
  public_key_encrypt: string;
  message: string;
};

export type UploadFileChunkResponse = {
  file_id: number;
  message?: string;
};

export type MyFileItem = {
  id: number;
  encrypted_filename: string;
  file_hash: string;
  file_size: number;
  created_at: string;
};

function authHeaders(userId: number): HeadersInit {
  return {
    'X-User-ID': String(userId),
  };
}

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

export async function loginUser(payload: LoginUserRequest): Promise<LoginUserResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Login request failed.';
    throw new Error(message);
  }

  return data as LoginUserResponse;
}

export async function uploadFileChunk(formData: FormData, userId: number): Promise<UploadFileChunkResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/files/upload`, {
    method: 'POST',
    headers: authHeaders(userId),
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Chunk upload failed.';
    throw new Error(message);
  }

  return data as UploadFileChunkResponse;
}

export async function getMyFiles(userId: number): Promise<MyFileItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/files/my-files`, {
    headers: authHeaders(userId),
  });
  const data = await response.json();

  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Failed to fetch files.';
    throw new Error(message);
  }

  return data as MyFileItem[];
}

export async function downloadFile(fileId: number, userId: number): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}/api/v1/files/${fileId}/download`, {
    headers: authHeaders(userId),
  });
  if (!response.ok) {
    let message = 'Failed to download file.';
    try {
      const data = await response.json();
      if (typeof data?.error === 'string') {
        message = data.error;
      }
    } catch {
      // Keep generic message if response is not JSON.
    }
    throw new Error(message);
  }

  return response;
}
