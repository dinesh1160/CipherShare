package models

import "time"

// User stores public key metadata for account registration.
type User struct {
	ID               int64     `json:"id"`
	Username         string    `json:"username" binding:"required"`
	PublicKeySign    string    `json:"public_key_sign" binding:"required"`
	PublicKeyEncrypt string    `json:"public_key_encrypt" binding:"required"`
	CreatedAt        time.Time `json:"created_at"`
}
