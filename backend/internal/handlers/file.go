package handlers

import (
	"database/sql"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"zero-trust-backend/database"

	"github.com/gin-gonic/gin"
)

type fileListItem struct {
	ID                int64  `json:"id"`
	EncryptedFilename string `json:"encrypted_filename"`
	FileHash          string `json:"file_hash"`
	FileSize          int64  `json:"file_size"`
	CreatedAt         string `json:"created_at"`
}

func GetMyFiles(c *gin.Context) {
	if database.DB == nil {
		log.Println("get my files: database is not initialized")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database not available"})
		return
	}

	userIDAny, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, ok := userIDAny.(int)
	if !ok || userID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authenticated user"})
		return
	}

	rows, err := database.DB.Query(
		`SELECT DISTINCT f.id, f.encrypted_filename, f.file_hash, f.file_size, f.created_at
		 FROM files f
		 LEFT JOIN file_access fa ON fa.file_id = f.id
		 WHERE f.owner_id = ? OR fa.user_id = ?
		 ORDER BY f.created_at DESC`,
		userID,
		userID,
	)
	if err != nil {
		log.Printf("get my files: query failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch files"})
		return
	}
	defer rows.Close()

	files := make([]fileListItem, 0)
	for rows.Next() {
		var item fileListItem
		if err := rows.Scan(&item.ID, &item.EncryptedFilename, &item.FileHash, &item.FileSize, &item.CreatedAt); err != nil {
			log.Printf("get my files: scan failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse files"})
			return
		}
		files = append(files, item)
	}

	if err := rows.Err(); err != nil {
		log.Printf("get my files: row iteration failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch files"})
		return
	}

	c.JSON(http.StatusOK, files)
}

func DownloadFile(c *gin.Context) {
	if database.DB == nil {
		log.Println("download file: database is not initialized")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database not available"})
		return
	}

	userIDAny, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, ok := userIDAny.(int)
	if !ok || userID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authenticated user"})
		return
	}

	fileID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || fileID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file id"})
		return
	}

	var fileHash string
	var signature string
	var fileSize int64
	err = database.DB.QueryRow(
		`SELECT file_hash, signature, file_size FROM files WHERE id = ?`,
		fileID,
	).Scan(&fileHash, &signature, &fileSize)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		log.Printf("download file: fetch metadata failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch file metadata"})
		return
	}

	var encryptedSymmetricKey string
	err = database.DB.QueryRow(
		`SELECT encrypted_symmetric_key FROM file_access WHERE file_id = ? AND user_id = ?`,
		fileID,
		userID,
	).Scan(&encryptedSymmetricKey)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
		log.Printf("download file: fetch file access failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch file access"})
		return
	}

	rows, err := database.DB.Query(
		`SELECT chunk_data FROM file_chunks WHERE file_id = ? ORDER BY chunk_index`,
		fileID,
	)
	if err != nil {
		log.Printf("download file: fetch chunks failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch file chunks"})
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusNotFound, gin.H{"error": "no chunks found for file"})
		return
	}

	c.Header("X-File-Hash", fileHash)
	c.Header("X-Signature", signature)
	c.Header("X-Encrypted-Key", encryptedSymmetricKey)
	c.Header("Content-Type", "application/octet-stream")
	c.Status(http.StatusOK)

	var writtenBytes int64
	var chunkData []byte

	if err := rows.Scan(&chunkData); err != nil {
		log.Printf("download file: scan first chunk failed: %v", err)
		return
	}
	bytesWritten, writeErr := c.Writer.Write(chunkData)
	if writeErr != nil {
		log.Printf("download file: write first chunk failed: %v", writeErr)
		return
	}
	writtenBytes += int64(bytesWritten)

	for rows.Next() {
		if err := rows.Scan(&chunkData); err != nil {
			log.Printf("download file: scan chunk failed: %v", err)
			return
		}

		bytesWritten, writeErr := c.Writer.Write(chunkData)
		if writeErr != nil {
			log.Printf("download file: write chunk failed: %v", writeErr)
			return
		}
		writtenBytes += int64(bytesWritten)
	}

	if err := rows.Err(); err != nil {
		log.Printf("download file: row iteration error: %v", err)
		return
	}

	if writtenBytes != fileSize {
		log.Printf("download file: streamed bytes mismatch (expected %d, wrote %d)", fileSize, writtenBytes)
	}
}

func UploadFileChunk(c *gin.Context) {
	if database.DB == nil {
		log.Println("upload file chunk: database is not initialized")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database not available"})
		return
	}

	encryptedFilename := strings.TrimSpace(c.PostForm("encrypted_filename"))
	fileHash := strings.TrimSpace(c.PostForm("file_hash"))
	signature := strings.TrimSpace(c.PostForm("signature"))
	fileSizeRaw := strings.TrimSpace(c.PostForm("file_size"))
	ownerIDRaw := strings.TrimSpace(c.PostForm("owner_id"))
	chunkIndexRaw := strings.TrimSpace(c.PostForm("chunk_index"))
	totalChunksRaw := strings.TrimSpace(c.PostForm("total_chunks"))
	fileIDRaw := strings.TrimSpace(c.PostForm("file_id"))
	ownerEncryptedKey := strings.TrimSpace(c.PostForm("owner_encrypted_symmetric_key"))

	if encryptedFilename == "" || fileHash == "" || signature == "" ||
		fileSizeRaw == "" || ownerIDRaw == "" || chunkIndexRaw == "" || totalChunksRaw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing required multipart fields"})
		return
	}

	fileSize, err := strconv.ParseInt(fileSizeRaw, 10, 64)
	if err != nil || fileSize < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file_size"})
		return
	}

	ownerID, err := strconv.ParseInt(ownerIDRaw, 10, 64)
	if err != nil || ownerID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid owner_id"})
		return
	}

	chunkIndex, err := strconv.Atoi(chunkIndexRaw)
	if err != nil || chunkIndex < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chunk_index"})
		return
	}

	totalChunks, err := strconv.Atoi(totalChunksRaw)
	if err != nil || totalChunks <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid total_chunks"})
		return
	}

	uploadedFile, err := c.FormFile("chunk_data")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chunk_data is required"})
		return
	}

	if chunkIndex == 0 {
		if ownerEncryptedKey == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "owner_encrypted_symmetric_key is required for chunk_index = 0"})
			return
		}

		tx, err := database.DB.Begin()
		if err != nil {
			log.Printf("upload file chunk: begin transaction failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialize file upload"})
			return
		}

		defer func() {
			if err != nil {
				_ = tx.Rollback()
			}
		}()

		result, err := tx.Exec(
			`INSERT INTO files (owner_id, encrypted_filename, file_hash, signature, file_size, total_chunks)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			ownerID,
			encryptedFilename,
			fileHash,
			signature,
			fileSize,
			totalChunks,
		)
		if err != nil {
			log.Printf("upload file chunk: insert file failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file record"})
			return
		}

		fileID, err := result.LastInsertId()
		if err != nil {
			log.Printf("upload file chunk: fetch file id failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file record"})
			return
		}

		_, err = tx.Exec(
			`INSERT INTO file_access (file_id, user_id, encrypted_symmetric_key)
			 VALUES (?, ?, ?)`,
			fileID,
			ownerID,
			ownerEncryptedKey,
		)
		if err != nil {
			log.Printf("upload file chunk: insert file access failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file access"})
			return
		}

		chunkReader, err := uploadedFile.Open()
		if err != nil {
			log.Printf("upload file chunk: open initial chunk_data failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read chunk_data"})
			return
		}

		chunkData, err := io.ReadAll(chunkReader)
		_ = chunkReader.Close()
		if err != nil {
			log.Printf("upload file chunk: read initial chunk_data failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read chunk_data"})
			return
		}

		_, err = tx.Exec(
			`INSERT INTO file_chunks (file_id, chunk_index, chunk_data) VALUES (?, ?, ?)`,
			fileID,
			chunkIndex,
			chunkData,
		)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique constraint failed: file_chunks.file_id, file_chunks.chunk_index") {
				c.JSON(http.StatusConflict, gin.H{"error": "chunk already uploaded for this file_id and chunk_index"})
				return
			}

			log.Printf("upload file chunk: insert initial chunk failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store initial chunk"})
			return
		}

		if err = tx.Commit(); err != nil {
			log.Printf("upload file chunk: commit failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to finalize file upload initialization"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"file_id": fileID, "message": "file upload initialized"})
		return
	}

	if fileIDRaw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file_id is required for chunk_index > 0"})
		return
	}

	fileID, err := strconv.ParseInt(fileIDRaw, 10, 64)
	if err != nil || fileID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file_id"})
		return
	}

	chunkReader, err := uploadedFile.Open()
	if err != nil {
		log.Printf("upload file chunk: open chunk_data failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read chunk_data"})
		return
	}
	defer chunkReader.Close()

	chunkData, err := io.ReadAll(chunkReader)
	if err != nil {
		log.Printf("upload file chunk: read chunk_data failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read chunk_data"})
		return
	}

	_, err = database.DB.Exec(
		`INSERT INTO file_chunks (file_id, chunk_index, chunk_data) VALUES (?, ?, ?)`,
		fileID,
		chunkIndex,
		chunkData,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint failed: file_chunks.file_id, file_chunks.chunk_index") {
			c.JSON(http.StatusConflict, gin.H{"error": "chunk already uploaded for this file_id and chunk_index"})
			return
		}

		log.Printf("upload file chunk: insert file chunk failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store file chunk"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"file_id": fileID, "message": "chunk uploaded"})
}
