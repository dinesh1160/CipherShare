package handlers

import (
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"zero-trust-backend/database"

	"github.com/gin-gonic/gin"
)

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
	if err != nil && chunkIndex > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chunk_data is required for chunk_index > 0"})
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
