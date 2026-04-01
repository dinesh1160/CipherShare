package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"strings"

	"zero-trust-backend/database"
	"zero-trust-backend/models"

	"github.com/gin-gonic/gin"
)

func RegisterUser(c *gin.Context) {
	var user models.User
	if err := c.ShouldBindJSON(&user); err != nil {
		log.Printf("register user: invalid request payload: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid request payload",
			"details": err.Error(),
		})
		return
	}

	if database.DB == nil {
		log.Println("register user: database is not initialized")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "database not available",
		})
		return
	}

	result, err := database.DB.Exec(
		`INSERT INTO users (username, public_key_sign, public_key_encrypt) VALUES (?, ?, ?)`,
		user.Username,
		user.PublicKeySign,
		user.PublicKeyEncrypt,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint failed: users.username") {
			log.Printf("register user: duplicate username '%s'", user.Username)
			c.JSON(http.StatusConflict, gin.H{
				"error": "username already exists",
			})
			return
		}

		log.Printf("register user: insert failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to register user",
		})
		return
	}

	userID, err := result.LastInsertId()
	if err != nil {
		log.Printf("register user: failed to read inserted id: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to register user",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user_id": userID,
		"message": "registered successfully",
	})
}

type loginRequest struct {
	Username string `json:"username" binding:"required"`
}

func LoginUser(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("login user: invalid request payload: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid request payload",
			"details": err.Error(),
		})
		return
	}

	if database.DB == nil {
		log.Println("login user: database is not initialized")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "database not available",
		})
		return
	}

	var user models.User
	err := database.DB.QueryRow(
		`SELECT id, username, public_key_sign, public_key_encrypt, created_at FROM users WHERE username = ?`,
		strings.TrimSpace(req.Username),
	).Scan(&user.ID, &user.Username, &user.PublicKeySign, &user.PublicKeyEncrypt, &user.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}

		log.Printf("login user: query failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to login"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":            user.ID,
		"username":           user.Username,
		"public_key_sign":    user.PublicKeySign,
		"public_key_encrypt": user.PublicKeyEncrypt,
		"message":            "login successful",
	})
}
