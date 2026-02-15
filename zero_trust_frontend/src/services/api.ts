const API_BASE_URL = 'http://localhost:8080';

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
