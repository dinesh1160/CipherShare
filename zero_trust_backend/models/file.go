package models

import "time"

// File stores encrypted metadata for a shared file.
type File struct {
	ID                int64     `json:"id"`
	OwnerID           int64     `json:"owner_id"`
	EncryptedFilename string    `json:"encrypted_filename"`
	FileHash          string    `json:"file_hash"`
	Signature         string    `json:"signature"`
	FileSize          int64     `json:"file_size"`
	TotalChunks       int       `json:"total_chunks"`
	CreatedAt         time.Time `json:"created_at"`
}

// FileChunk stores one encrypted chunk of file data.
type FileChunk struct {
	ID         int64     `json:"id"`
	FileID     int64     `json:"file_id"`
	ChunkIndex int       `json:"chunk_index"`
	ChunkData  []byte    `json:"chunk_data"`
	CreatedAt  time.Time `json:"created_at"`
}
