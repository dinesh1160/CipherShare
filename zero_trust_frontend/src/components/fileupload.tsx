import { useState } from 'react';

export default function UploadTemplate() {
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        setUploadedFiles([...uploadedFiles, ...files]);
    };

    const handleClear = () => {
        setUploadedFiles([]);
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
            <h3>Upload Files</h3>
            <input
                type="file"
                multiple
                onChange={handleFileChange}
                style={{ display: 'block', marginBottom: '1rem' }}
            />
            {uploadedFiles.length > 0 && (
                <div>
                    <h4>Uploaded Files ({uploadedFiles.length})</h4>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {uploadedFiles.map((file, index) => (
                            <li key={index} style={{ padding: '0.5rem', marginBottom: '0.5rem' }}>
                                {file.name} — {(file.size / 1024).toFixed(2)} KB
                            </li>
                        ))}
                    </ul>
                    <button onClick={handleClear}>Clear Files</button>
                </div>
            )}
        </div>
    );
}
        